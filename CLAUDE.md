# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Visão geral

Validador de arquivos CNAB do Bradesco. A estratégia é **reimplementação nativa em Rust** a partir de
regras extraídas automaticamente (via AST) dos assets JavaScript públicos do validador oficial do banco
— e não um wrapper sobre o JS original.

**Estado atual: Fase 0 fechada, Fase 1 em andamento.** Existem o extrator (`tools/spec-extractor/`,
Bun + TypeScript), os specs JSON que ele gera (`tools/specs/`) e dois crates Rust:
`crates/cnab-specs` (o consumidor do contrato) e `crates/cnab-core` (o motor, em paridade verificada
com o runner TS). `cnab-validator-cli` e `cnab-validator-api` ainda **não** existem; o design deles
está em `docs/superpowers/specs/2026-08-18-validador-cnab-bradesco-design.md`.

Layouts do ciclo atual: `cobranca-remessa`, `multipag`, `folha-pagamento`, `retorno-multipag`.

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
bun run golden      # compara o runner com o validador oficial executado localmente
bun run paridade    # congela o relatório do runner em tools/paridade/, para o motor Rust
```

`bun run dev` é a **única** coisa que acessa a rede; os testes mockam `global.fetch`.

`bun run golden` é **local e opcional**: executa as funções do próprio banco, a partir do corpus em
`assets/`, num contexto `node:vm`, e compara com o runner. Como `assets/` não é versionado, o script
e `tests/golden.test.ts` se declaram pulados quando o corpus não está lá — é assim que o oráculo
convive com o CA2 da #7 (o CI não toca a rede do banco). Só **falso positivo** derruba o script;
lacuna de cobertura precisa de causa registrada em `src/golden-conhecidas.ts`.

### Crates Rust

```bash
cargo test            # da raiz; carrega os specs versionados e verifica o contrato
cargo clippy --all-targets -- -D warnings
cargo fmt --all
```

`crates/cnab-specs` é o **consumidor do contrato**, não um validador: carrega `tools/specs/` em
structs e falha alto quando o JSON não casa. Duas escolhas que sustentam isso e não devem ser
afrouxadas sem decisão explícita:

- **`deny_unknown_fields` em todas as structs.** Campo novo publicado pelo extrator quebra a carga do
  lado Rust, o que força atualizar os dois juntos. É o oposto de ignorar em silêncio uma informação
  que o validador oficial usa.
- **Nenhuma variante "desconhecida"** em `Condicao` nem em `VariavelDaGuarda`. Arquétipo novo faz a
  carga falhar, pela mesma razão que o runner reporta *não avaliada* em vez de aprovar.

Os nomes dos tipos seguem o JSON, em português: traduzir criaria um segundo vocabulário para as
mesmas coisas. Nenhuma variante precisa de `#[serde(rename)]` — `rename_all = "snake_case"` dá conta
de todas. Ao criar uma, conferir que o nome em `CamelCase` produz o nome do JSON: um arquétipo que
termine em número (o antigo `Modulo11` virava `modulo11`, sem o sublinhado) precisaria do `rename`, e
é sinal de que o nome escolhido está descrevendo o algoritmo em vez do que a regra faz.

`crates/cnab-core` é o motor: `aplicar_spec(&regras, &linhas)` devolve achados e não avaliadas. Ele é
o espelho do runner TS, e é isso que sustenta a paridade:

- `src/valor.rs` reproduz a coerção do JavaScript (`igual_js`, `relacional_js`, `numero_js`). É o que
  faz campo em branco valer zero na comparação frouxa. `numero_js` cobre só o literal decimal —
  `0x1f` e `Infinity` viram `NaN` de propósito, porque não existem em arquivo CNAB e aceitá-los
  abriria divergência onde o fonte nunca chega.
- `src/expressao.rs` avalia as guardas, com curto-circuito de `&&` e `||`, e recusa o que não
  reconhece.
- **Paridade:** `bun run paridade` congela o relatório do runner em `tools/paridade/<layout>/`, e
  `crates/cnab-core/tests/paridade.rs` compara achado a achado e recusa a recusa. Do lado Bun,
  `tests/paridade.test.ts` falha se o congelado sair de sincronia com o runner. Mudou o
  comportamento de um dos dois motores? Regenere e **olhe o diff** — ele é a evidência de qual dos
  lados mudou.
- O `detalhe` da recusa fica fora da comparação: é diagnóstico para quem lê o relatório, e prendê-lo
  travaria a redação da mensagem nos dois lados. O par (regra, motivo) é o que precisa concordar.

## CI

O workflow `.github/workflows/ci.yml` roda em todo push e PR para `main` e `fase-0-extrator`:

- `typecheck`: `bun install` + `bun run typecheck`.
- `test`: `bun install` + `bun test`.
- `reproducibility`: `bun install` + `bun run reproduce` — regera specs a partir do corpus fixture e falha se o resultado não for byte-a-byte idêntico aos golden specs versionados.
- `diff-specs` (apenas em PRs): se `tools/specs/` for alterado, publica um resumo agregado por layout, tipo de registro e arquétipo de condição usando `src/diff-summary.ts`.
- `rust`: `cargo fmt --check`, `cargo clippy -D warnings` e `cargo test`. Como `cnab-specs` carrega os specs versionados, mudança de contrato publicada sem atualizar as structs falha aqui.

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

O fonte tem **duas formas**, e o pipeline tem um modo para cada — `MODO_POR_FUNCAO` em `config.ts`
decide qual roda:

- **`regras`** (remessa): "condição → mensagem de erro". Passa por `ast-walker` + `rule-mapper`.
- **`tabelas`** (retorno): "campo igual a código → rótulo". É dicionário, não regra, e passa por
  `dominio-extractor` + `dominio-mapper`. O catálogo vive numa **função aninhada** dentro da função
  de layout, então esse extrator entra em `FunctionDeclaration` interna — o walker de regras não
  entra, e não precisa.

`src/digito-verificador.ts` expõe o módulo 11 de agência e conta **sobre um par**, derivando pesos,
módulo, tratamento de resto, rejeição de caixa baixa e fronteira de banco das próprias regras — é o
que permite auditar cadastro sem gerar arquivo. Não reimplementar o algoritmo em outro lugar: uma
cópia manual diverge do fonte na primeira atualização dele.

Fora do pipeline, `src/runner/` aplica um spec a um arquivo e devolve achados —
`expressao.ts` (avaliador das guardas, que a DSL não modela), `condicao.ts` (avaliador dos
arquétipos) e `index.ts` (orquestração e relatório). É **oráculo de teste, não validador**: sem CLI,
sem API, sem detecção de layout, sem encoding. Nada é aprovado por omissão — `custom`, condição
incompleta e guarda não reconhecida viram *não avaliadas* com contagem. Quando `cnab-core` existir, o
diff entre os dois sobre o mesmo corpus é o teste de paridade.

O avaliador de guardas **curto-circuita `&&` e `||`**, como o JavaScript. Não é otimização: a guarda
começa identificando o registro e só depois compara o dígito, então numa linha que não é aquele
registro o fonte nunca chega à parte que depende do cálculo. Avaliar os dois lados fazia a regra ser
recusada em todas as linhas do arquivo por uma expressão que o validador não olha. O curto-circuito
nunca decide a favor: com a esquerda verdadeira, uma direita não reconhecida continua recusando.

Pontos que só ficam claros lendo vários arquivos juntos:

- **`config.ts` é a fonte da verdade do escopo.** Adicionar layout = adicionar entrada em
  `LAYOUTS_DO_CICLO`, `MAPEAMENTO_FUNCOES` (função JS → layout) e `LAYOUTS`. O `spec-generator` falha
  em layout desconhecido; o `index.ts` ignora função fora de `LAYOUTS_DO_CICLO`.
- **O que vira regra é decidido por duas evidências independentes** (`isNoise`): a mensagem cita
  linha **e** coluna, **ou** o texto traz um indicativo de erro. Nenhuma basta sozinha — o fonte tem
  regra que não cita coluna (comprimento do registro) e regra cujo texto não usa palavra de erro
  ("Número do banco diferente no mesmo lote", que é a regra de banco único por lote). Ao mexer aqui,
  medir o diff **de conjunto** (quantas regras entram e quantas somem), não só a reclassificação.
- **O alvo da regra decide em que linhas ela roda**, e não vem só do teste. Quando o `if` compara
  variáveis calculadas antes dele (`qtde_reg != qtde_linha`), o teste não lê registro nenhum e o alvo
  sai da **guarda mais interna** — a mesma que já dá o tipo de registro. Sem isso ele cai no default
  `res[0]`, e a regra passa a valer só para o header, onde a guarda dela nunca vale: existe no spec e
  não reprova nada. O índice pode ser aritmético (`res[j + 1]` alcança o registro seguinte, como nas
  regras do Segmento R sob o P) — o consumidor já resolve essa forma, e o extrator a publica.
- **O walker mantém um ambiente de variáveis** (`RawRule.ambiente`): atribuições vistas até a regra,
  com a pilha de guardas de cada uma. Uma atribuição alcança a regra quando as duas estão na mesma
  linha de aninhamento — uma pilha de guardas é prefixo da outra. O que precisa ficar de fora é o
  **ramo irmão** do cálculo de dígito (o fonte repete o bloco inteiro por valor informado), e ele fica:
  nenhuma das duas pilhas contém a outra. As duas direções são legítimas por razões diferentes — a
  atribuição sob **mais** guardas é o ramo do cálculo (`if (resto == 0) dv = 0`), publicado como faixa
  de resto; a sob **menos** foi executada sempre que a regra é alcançada, e é o caso de
  `dv10 = 10 - resto10`, calculado antes de o `if` de ramo abrir.
- **A classificação usa os dois ambientes**, com o da regra por cima do da guarda. As parcelas do
  somatório do código de barras vivem cada uma sob o seu próprio `if` de redução, e só o ambiente da
  guarda as alcança; o da regra é o mais específico e precisa vencer onde os dois definem a mesma
  variável, que é o caso do bloco repetido por dígito. Acumulador de mensagem (`resposta = resposta + "…"`) é filtrado por
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
- Arquétipos de `condicao`: `literal_fixo`, `numerico_branco`, `dominio`, `intervalo`,
  `digito_verificador`, `coerencia_registro`, `numero_da_linha`, `tamanho_linha`, `disjuncao`,
  `conjuncao`, `custom`. `custom` é o escape hatch
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
- `coerencia_registro` cobre duas leituras comparadas entre si — a mesma faixa em linhas distintas
  (`res[i]` contra `res[j]`), que sustenta "banco único por lote", **e** dois campos da mesma linha,
  que é como o fonte compara datas. O operador pode ser relacional; o par (`alvo`, `outro`) diz se a
  comparação atravessa registros. `ajuste` e `ajuste_outro` carregam o deslocamento constante que o
  fonte soma a um dos lados: `- 1` no sequencial que avança de um em um, `- 2` na quantidade de
  registros do lote (que conta header e trailer, e o sequencial do último detalhe não). **A presença
  de ajuste muda o tipo da comparação** — sem ele o fonte compara texto com texto, com ele o `-` do
  JavaScript já converteu o lado ajustado para número e o `==` coage o outro; faixa não numérica vira
  `NaN`, que difere de tudo, e é assim que o fonte reprova. `null` nos dois campos é comparação
  textual, e é o que as demais regras de coerência trazem.
- `numero_da_linha` é a faixa comparada com a **variável de fluxo do laço**, não com literal nem com
  outra faixa: é como o fonte confere a quantidade de registros do arquivo (`qtde_reg != qtde_linha`,
  com `qtde_linha = j`) e o sequencial de registro do CNAB 400. Depende do ambiente do walker — sem
  ele a condição é só `qtde_reg != qtde_linha`, que não diz nada, e a regra fica em `custom`. `fluxo`
  é a expressão a que o lado direito se resolve (`j`, que vale `i + 1`, logo o número 1-based da
  linha corrente) e `variavel` é o nome que a condição escreve. O motor resolve `fluxo` pelo mesmo
  caminho que já resolve `res[j]`: a convenção do laço é uma só, e publicá-la aqui como número
  abriria espaço para as duas divergirem. A comparação é numérica — o fonte compara texto com número.
- `intervalo` cobre a comparação relacional (`>`, `>=`, `<`, `<=`) contra literal; vários limites
  sobre a mesma faixa descrevem um intervalo, como o `>= 'a' && <= 'z'` que o fonte usa para rejeitar
  minúscula no dígito.
- `dobra` viaja junto de `base`/`modulo` e diz o que o fonte faz com cada parcela **antes de somar**:
  quando o produto passa de `limite`, subtrai `subtrai`. É o módulo 10 do código de barras do Segmento
  O, escrito no fonte como um `if` por posição. Os dois números são publicados literalmente em vez de
  um nome de algoritmo — coincidem em 9 hoje, e assumir isso esconderia a mudança se o banco mexer num
  deles. `null` é a soma ponderada direta. Reduzir o total em vez de cada parcela dá outro número, e
  soma com reduções diferentes **não é publicada** — o cálculo fica de fora e a regra continua não
  avaliável.
- `digito_verificador` é um arquétipo só para os **dois** algoritmos que o validador usa, e é `modulo`
  — com `dobra`, quando existe — que diz qual: módulo 11 na agência, na conta e na inscrição; módulo
  10 com redução por parcela no código de barras do Segmento O. O nome descreve o que a regra faz, não
  a aritmética: um arquétipo por algoritmo duplicaria `base`, `resultado` e a resolução do ambiente
  para publicar a mesma coisa com outro divisor.
- `digito_verificador` **depende do ambiente que o walker captura**: o fonte calcula o dígito numa variável
  antes do `if` (soma ponderada → resto → um `if` por faixa de resto) e a condição só compara a faixa
  com essa variável. `base` traz as parcelas com peso, `modulo` o divisor, `resultado` o dígito
  esperado por faixa de resto **na ordem do fonte** (uma atribuição sem `operador` é o valor padrão,
  que os `if` seguintes sobrescrevem — a última que casa vence), e `variavel` o nome no fonte. O
  validador **repete o bloco de cálculo inteiro por valor informado no dígito**, então a mesma faixa
  de resto tem resultado diferente em cada ramo; a guarda da regra diz qual ramo é. Sem ambiente não
  se publica `digito_verificador`: a condição sozinha é `faixa != variavel` e afirmar um algoritmo que
  o extrator não viu seria inventar.
- `variaveis_guarda` publica o cálculo das variáveis que a **guarda** referencia, e é o que torna a
  regra do segundo dígito avaliável: a guarda dela compara a faixa com o **primeiro** dígito, que o
  fonte calculou antes do `if`. Cada variável é `digito_verificador` (dígito, com `resultado` por faixa de
  resto) ou `resto` (só a soma ponderada e o módulo — o fonte compara restos entre si para escolher
  qual dígito exigir). A resolução usa o ambiente **do ponto em que a guarda foi aberta**, não o da
  regra: o fonte reusa `sm` dentro do bloco, e resolver pela ordem da regra daria ao primeiro dígito
  a soma ponderada do segundo. Variável que não se resolve inteira não é publicada — a guarda que
  depende dela continua não avaliável, que é o resultado honesto.
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

#### Contrato dos campos de domínio (retorno)

`campos` no spec de layout é a saída do modo `tabelas`, e o consumidor de retorno vive dele:

- **`slots`**: o campo de ocorrências carrega **cinco** códigos de dois dígitos concatenados. Ler o
  campo como código único perde quatro — e o que se perde costuma ser a causa secundária. Cada
  entrada diz em quais fatias aquele código é reconhecido, porque o fonte não decodifica todos em
  todas.
- **`registros_lidos`**: em que tipos de registro o fonte lê o campo. Para as ocorrências isso inclui
  **header e trailer, de arquivo e de lote** — recusa de envelope chega por aí, e um processador que
  varra só o detalhe lê "nenhum erro" num arquivo inteiro recusado. Sai das tabelas irmãs que
  decodificam a posição do tipo de registro no mesmo bloco do fonte.
- **`fora_do_dominio: "desconhecido"`**: código não catalogado nunca é ignorado nem tratado como
  sucesso.
- **`condicao_extra`** preserva a segunda condição do `if` quando existe (o fonte usa isso para
  excluir um segmento de um código).
- Fatias do mesmo campo são reconhecidas por serem contíguas, de mesma largura e com domínio quase
  igual; o **nome** do campo vem de `CAMPOS_NOMEADOS` em `config.ts`, porque o fonte não o nomeia.
- O **id do campo termina na linha do bloco no fonte** (`…:campo_16_17:7926`). A faixa não identifica
  o campo: o fonte decodifica as mesmas colunas em blocos diferentes com dicionários diferentes —
  016-017 é situação do pagamento num bloco e ocorrência de cobrança em outro. Sem a linha, os dois
  colidem e quem indexar por id perde um catálogo inteiro.
- `registros_lidos` vazio significa **indeterminado**, não "nenhum": ele sai das tabelas irmãs que
  decodificam o tipo de registro no mesmo bloco, e nem todo bloco as tem. Onde ele é indispensável é
  no campo de ocorrências.

`tools/specs/divergencias.json` é o catálogo manual × validador. A curadoria vive em
`src/divergencias.ts` — o manual não é código —, mas cada item é **verificado contra a extração**:
divergência declarada sobre código que o validador não trata quebra a geração. Prevalece sempre o
validador. É a saída de maior valor da fase para outros repositórios.

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

São **dois** baselines versionados, com propósitos diferentes. Um só arquivo faria o aviso do monitor
disparar em toda execução — e alerta que sempre toca não é alerta.

- **`baseline.json`** — hash SHA-256 do corpus de **fixture** (`tests/fixtures/corpus-fixture.js`),
  usado pelo gate de reprodutibilidade. Ao mudar o corpus de fixture, regenere o hash e commite;
  há teste que falha se os dois saírem de sincronia.
- **`baseline-corpus.json`** — hash do corpus **público do banco**, com as URLs de origem e a data da
  captura. É o monitor de mudança: `bun run dev` compara o corpus baixado com este hash e avisa
  quando divergir, o que significa que o banco atualizou o validador e os specs precisam ser
  revisados. Não quebra a execução; quando confirmada a mudança, regenere os specs e atualize o
  arquivo com o novo hash e a nova data.
- `assets/` continua fora do git. `bun run dev` ainda grava `assets/baseline.json` com o hash do
  corpus baixado para referência local, mas a fonte de verdade da comparação é o arquivo versionado.

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
