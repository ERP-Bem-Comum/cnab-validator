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
```

`bun run dev` é a **única** coisa que acessa a rede; os testes mockam `global.fetch`.

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
- Arquétipos de `condicao`: `literal_fixo`, `numerico_branco`, `dominio`, `modulo_11`,
  `coerencia_registro`, `custom`. `custom` é o escape hatch — regra que não casa com nenhum matcher
  cai nele com `condicao_original` preservada. Aumentar a cobertura = adicionar matcher em
  `inferirCondicao`, sempre mantendo `condicao_original` intacta.

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
