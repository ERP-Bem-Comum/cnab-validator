# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

Validador de arquivos CNAB do Bradesco. A estratégia é **reimplementação nativa em Rust** a partir de
regras extraídas automaticamente (via AST) dos assets JavaScript públicos do validador oficial do banco
— e não um wrapper sobre o JS original.

**Estado atual: Fase 0.** Só existe o extrator (`tools/spec-extractor/`, Bun + TypeScript) e os specs
JSON que ele gera (`tools/specs/`). Os crates Rust (`cnab-core`, `cnab-specs`, `cnab-validator-cli`,
`cnab-validator-api`) ainda **não** foram criados — o design deles está em
`docs/superpowers/specs/2026-08-18-validador-cnab-bradesco-design.md`.

Layouts do ciclo atual: `cobranca-remessa`, `multipag`, `folha-pagamento`.

## Comandos

Todos rodam em `tools/spec-extractor/` (package manager: **bun**):

```bash
bun install
bun run dev         # baixa assets do Bradesco, extrai regras, grava tools/specs/ (faz rede)
bun test            # suíte completa (bun:test)
bun test tests/rule-mapper.test.ts        # arquivo único
bun test -t "extrai regras"               # filtro por nome do teste
bun run typecheck   # tsc --noEmit
bun run reproduce   # verifica reprodutibilidade contra specs fixture (sem rede)
```

`bun run dev` é a **única** coisa que acessa a rede; os testes mockam `global.fetch`.

## CI

O workflow `.github/workflows/ci.yml` roda em todo push e PR para `main` e `fase-0-extrator`:

- `typecheck`: `bun install` + `bun run typecheck`.
- `test`: `bun install` + `bun test`.
- `reproducibility`: `bun install` + `bun run reproduce` — regera specs a partir do corpus fixture e falha se o resultado não for byte-a-byte idêntico aos golden specs versionados.
- `diff-specs` (apenas em PRs): se `tools/specs/` for alterado, publica um resumo agregado por layout, tipo de registro e arquétipo de condição usando `src/diff-summary.ts`.

**Restrições de CI:**

- Nenhum job faz requisições de rede aos assets do banco (`bun run dev` não roda em CI).
- Nenhum conteúdo de asset do banco é ecoado em log (não usar `cat` de arquivos baixados).

## Arquitetura do extrator

Pipeline linear, um módulo por etapa (`tools/spec-extractor/src/`):

```
downloader.ts     HTML + .js do validador; extrai <script src> e scripts inline (com lineOffset)
inline-parser.ts  AST (acorn) → índice de funções nomeadas por nome
ast-walker.ts     percorre o corpo da função-alvo, transforma IfStatement + mensagem em RawRule
rule-mapper.ts    RawRule → DslRule (classifica a condição em um dos arquétipos da DSL)
spec-generator.ts DslRule[] → tools/specs/index.json + tools/specs/layouts/<layout>.json
index.ts          orquestração: main() (com I/O) e runPipeline() (pura)
config.ts         URL do validador, layouts do ciclo, MAPEAMENTO_FUNCOES, metadados de layout
```

Pontos que só ficam claros lendo vários arquivos juntos:

- **`config.ts` é a fonte da verdade do escopo.** Adicionar layout = adicionar entrada em
  `LAYOUTS_DO_CICLO`, `MAPEAMENTO_FUNCOES` (função JS → layout) e `LAYOUTS`. O `spec-generator` falha
  em layout desconhecido; o `index.ts` ignora função fora de `LAYOUTS_DO_CICLO`.
- **O walker mantém um ambiente de variáveis** (`RawRule.ambiente`): atribuições vistas até a regra,
  com a pilha de guardas de cada uma. Uma atribuição só alcança a regra se toda guarda da regra vale
  também para ela — sem esse escopo o ramo irmão do cálculo de dígito vazaria e o spec publicaria dois
  resultados contraditórios. Acumulador de mensagem (`resposta = resposta + "…"`) é filtrado por
  conteúdo, não por tamanho: o somatório de CNPJ passa de 600 caracteres.
- **`runPipeline()` é pura e testável** (recebe `Map<url, source>` + inline scripts + logger injetável);
  `main()` concentra rede e escrita em disco. Novos testes de orquestração devem usar `runPipeline`.
- **`Logger` é injetado** em `runPipeline` e `mapToDsl` (default no-op nos testes, `console` no CLI).
  Não introduzir `console.log` direto nos módulos de extração.
- **Destino dos specs é `tools/specs/`** (`SPECS_DIR = src/../../specs`), não `specs/` na raiz como
  aparece no diagrama do design doc. Os specs são versionados; `assets/` e `assets/baseline.json`
  (hash SHA-256 do corpus baixado) não são.

### Contrato dos specs

Os JSONs de `tools/specs/` são o contrato que os crates Rust vão consumir. Mudar nomes de campos ou
variantes de `DslCondition` quebra `cnab-specs`. Invariantes:

- `id` da regra = `<layout>:<funcao_origem>:<linha_fonte>` — determinístico, logo o output do extrator
  deve ser reprodutível (nada de timestamps, ordem randômica ou índice de contador).
- `linha_fonte` é a linha **absoluta no arquivo original**; para scripts inline soma-se o `lineOffset`
  calculado no `downloader`. Preservar isso ao mexer na extração inline.
- Duas convenções de posição coexistem: `inicio0`/`fim0` são 0-based com fim exclusivo (espelham
  `String.substring(a, b)` do JS) e `colunas` é 1-based inclusivo (`[inicio0 + 1, fim0]`), usado nas
  mensagens.
- Arquétipos de `condicao`: `literal_fixo`, `numerico_branco`, `dominio`, `intervalo`, `modulo_11`,
  `coerencia_registro`, `tamanho_linha`, `disjuncao`, `conjuncao`, `custom`. `custom` é o escape hatch
  — regra que não casa com nenhum matcher cai nele com `condicao_original` preservada. Aumentar a
  cobertura = adicionar matcher em `inferirCondicao`, sempre mantendo `condicao_original` intacta.
- `comparacao` (`estrita` | `frouxa`) existe em `literal_fixo` e `dominio` e **não é decoração**: o
  fonte compara o resultado de `substring()` — sempre string — ora contra literal entre aspas, ora
  contra literal numérico, e no segundo caso o JavaScript coage os tipos (`" 1"` passa como `01`). Um
  motor que compare bytes só reproduz o validador oficial se respeitar esse campo. Pelo mesmo motivo
  `operador` é publicado já resolvido (`!(a == b)` vira `!=`), e `!==` colapsa em `!=` — o que os
  separava virou `comparacao`.
- `dominio` carrega `sentido`: `permitidos` (conjunção de desigualdades — erro quando o campo não é
  nenhum dos valores) ou `proibidos` (disjunção de igualdades — erro quando é algum deles). Ler
  `valores` sem olhar o `sentido` inverte a regra.
- `numerico_branco` carrega `exige` (`numerico`, `numerico_preenchido`, `branco`) e o `residuo`
  literal do fonte. As três formas partem do mesmo `isNaN(...)` e divergem só no teste residual, mas
  pedem coisas opostas — uma exige conteúdo numérico, a outra exige branco. Combinação de resíduo
  ainda não vista cai em `custom` de propósito, em vez de ser encaixada à força numa exigência que o
  fonte não faz.
- `disjuncao` e `conjuncao` modelam o `||` e o `&&` com que o fonte cobre várias faixas sob uma única
  mensagem (`partes` são condições completas). Só são publicadas quando **todas** as partes têm
  arquétipo próprio. Nessas regras `posicoes` lista todas as faixas lidas e `colunas` é o envelope —
  mas **só das faixas do alvo da regra**: uma parte que lê `res[i + 2]` fala de outra linha do
  arquivo, e somá-la ao envelope produziria uma faixa que não existe em registro nenhum. Nas demais
  regras `posicoes` continua com uma entrada só.
- `intervalo` cobre a comparação relacional (`>`, `>=`, `<`, `<=`) contra literal; vários limites
  sobre a mesma faixa descrevem um intervalo, como o `>= 'a' && <= 'z'` que o fonte usa para rejeitar
  minúscula no dígito.
- `modulo_11` **depende do ambiente que o walker captura**: o fonte calcula o dígito numa variável
  antes do `if` (soma ponderada → resto → um `if` por faixa de resto) e a condição só compara a faixa
  com essa variável. `base` traz as parcelas com peso, `modulo` o divisor, `resultado` o dígito
  esperado por faixa de resto **na ordem do fonte** (uma atribuição sem `operador` é o valor padrão,
  que os `if` seguintes sobrescrevem — a última que casa vence), e `variavel` o nome no fonte. O
  validador **repete o bloco de cálculo inteiro por valor informado no dígito**, então a mesma faixa
  de resto tem resultado diferente em cada ramo; a guarda da regra diz qual ramo é. Sem ambiente não
  se publica `modulo_11`: a condição sozinha é `faixa != variavel` e afirmar um algoritmo que o
  extrator não viu seria inventar.
- Três condições coexistem por regra e não são intercambiáveis: `condicao_original` é a conjunção
  completa (guardas + teste) e existe para rastreabilidade; `condicao_guarda` são só os `if` externos;
  `condicao_propria` é o teste que emite a mensagem — **é ela que a DSL classifica e de onde saem as
  posições**. Classificar pela conjunção completa faz a guarda mais externa ditar as colunas da regra.
  A exceção é a **fusão de cadeia**: `inferirDominio` roda primeiro sobre `condicao_original`, porque
  o fonte expressa domínio negado encadeando um `if` por valor sobre a mesma posição, com uma única
  mensagem no nível mais interno. Sem essa tentativa antes, a cadeia vira uma regra `literal_fixo` de
  um valor só e o domínio se perde.
- `colunas` é a faixa que a condição efetivamente lê; `colunas_mensagem` guarda a faixa declarada na
  mensagem quando difere. O fonte reporta o campo inteiro (ex.: o CNPJ) e testa só uma parte dele
  (ex.: o dígito) — são informações distintas e ambas necessárias.
- Regra sem faixa (comprimento de linha, por exemplo) tem `posicoes: []` e `colunas: [0, 0]`. Nunca
  publicar posição inventada: um motor leria a coluna errada.

#### Classificação do tipo de registro

- A **guarda tem precedência sobre a mensagem**: `res[i].substring(7, 8) == 3` identifica o registro
  mesmo quando o texto não o nomeia. `registro_origem` registra de onde veio (`guarda` | `mensagem`).
- A leitura da guarda depende da **família** do arquivo, não do layout: `FAMILIA_POR_FUNCAO`
  (`config.ts`) mapeia cada função para `cnab240` (tipo na posição 008, segmento na coluna 014),
  `cnab400` ou `cnab200` (tipo na coluna 001, sem segmento). `cobranca-remessa` agrega 240 e 400 num
  layout só — ao mexer em classificação, tratar as duas taxonomias separadamente.
- Quando a mensagem cita mais de um registro, vence o que aparece **primeiro no texto**; empate no
  mesmo offset é decidido pelo termo mais longo (senão "Segmento J-52" é engolido por "segmento J").
  Os demais viram `registro_referenciado` — é o gancho das regras de coerência entre registros.
- Igualdade sob `!` não identifica registro: `!(res[i].substring(13, 14) == "P")` afirma o contrário.
- `tests/propriedades.test.ts` é a rede: roda sobre os specs versionados e falha se algum registro
  contradisser a guarda que o cerca, se houver posição incoerente ou id duplicado. Sem asserções de
  contagem — o número de regras muda a cada melhoria do extrator, as invariantes não.

### Política de baseline

- `tools/spec-extractor/baseline.json` é versionado e contém o hash SHA-256 do corpus de fixture
  (`tests/fixtures/corpus-fixture.js`) usado no gate de reprodutibilidade. **Não é o hash do corpus
  do Bradesco.**
- `assets/` continua fora do git. `bun run dev` ainda grava `assets/baseline.json` com o hash do
  corpus baixado para referência local, mas a fonte de verdade para comparação é o arquivo
  versionado.
- Ao rodar `bun run dev`, o extrator compara o hash do corpus baixado com o baseline versionado.
  Se divergir, emite um `console.warn` explícito, mas **não** quebra a execução. Isso sinaliza que
  o validador do banco pode ter sido atualizado.
- Para atualizar o baseline (por exemplo, após uma mudança intencional no corpus fixture), regenere
  `baseline.json` a partir de `tests/fixtures/corpus-fixture.js` e commit o novo hash.

### Fidelidade à fonte

A fonte da verdade é o JavaScript do Bradesco, **não** o manual FEBRABAN genérico: capturar literalmente
strings, offsets e comportamentos programados no validador oficial, inclusive quando divergem do padrão.
As divergências propositais em relação ao validador oficial estão tabeladas na seção 7 do design doc.

`README.md` do extrator documenta a política de retry do downloader e as limitações conhecidas da
extração inline por regex — atualizar lá ao mexer nesses pontos.

## Documentação e fluxo de trabalho

`docs/superpowers/` segue o fluxo superpowers: `specs/` para design e `plans/` para planos de execução
com tasks/steps em checkbox. O plano da fase atual é
`docs/superpowers/plans/2026-08-18-fase-0-extrator-de-regras.md` (os checkboxes não vinham sendo
marcados; o código já foi além do plano em vários pontos — conferir o código antes de confiar no plano).

Branch por fase (`fase-0-extrator`). Commits em Conventional Commits com descrição em pt-BR.

## Repositórios de referência (gitignorados)

- `.boletonet-ref/` — BoletoNet (C#): referência de estrutura CNAB 240/400 e cálculo de dígito verificador.
- `.rust-skills-ref/` — plugin rust-skills: diretrizes de codificação Rust adotadas nas fases seguintes.

São clones externos só para consulta; nunca editar nem commitar nada dentro deles.
