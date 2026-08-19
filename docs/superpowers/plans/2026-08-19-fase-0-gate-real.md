# Plano de Ação — Fase 0: o extrator precisa virar gate real

**Data:** 2026-08-19
**Branch:** `fase-0-extrator`
**Base:** issues [#1](https://github.com/ERP-Bem-Comum/cnab-validator/issues/1) a [#5](https://github.com/ERP-Bem-Comum/cnab-validator/issues/5),
`docs/superpowers/specs/2026-08-18-validador-cnab-bradesco-design.md` e
`docs/superpowers/plans/2026-08-18-fase-0-extrator-de-regras.md` (plano de bootstrap, já superado pelo código).

**Marco da fase (do épico #5):** um arquivo de remessa gerado pelo core-api é submetido ao validador e
**reprovado pelo motivo certo** quando contém o defeito conhecido, e **aprovado** quando correto.

**Higiene (repositório público):** nada de texto do manual ou do fonte oficial em arquivo versionado.
Este plano cita **código de campo, posição de coluna e referência de linha** — nunca o texto. Fixtures
usam pares sintéticos.

---

## 1. O que foi medido, não o que estava escrito

Medição em 2026-08-19 sobre `tools/specs/` e sobre os assets em `tools/spec-extractor/assets/`.

### 1.1 Cobertura real dos specs

| Layout | Regras no spec | Mensagens de erro no fonte¹ | Cobertura |
|---|---:|---:|---:|
| `multipag` | 42 | 513 | ~8% |
| `cobranca-remessa` | 35 | 740 | ~5% |
| `folha-pagamento` | 66 | 308 | ~21% |
| **Total** | **143** | **1.561** | **~9%** |

¹ Contagem de mensagens que carregam referência de linha no fonte oficial — teto superior grosseiro
do que é extraível, não meta.

### 1.2 Distribuição por tipo de registro — o sintoma da #1

| Registro | multipag | cobrança | folha | total |
|---|---:|---:|---:|---:|
| `header-arquivo` | 36 | 30 | 52 | **118** |
| `header-lote` | 0 | 1 | 2 | **3** |
| `nao-classificado` (ruído) | 6 | 4 | 12 | **22** |
| segmentos / trailers | **0** | **0** | **0** | **0** |

O épico dizia "42 regras, zero de segmento" para o Multipag. Confirmado — e o padrão se repete nos
outros dois layouts. **Zero regra de segmento e zero de trailer em todo o repositório.**

### 1.3 Distribuição por arquétipo da DSL — um sintoma que não estava em nenhuma issue

| Arquétipo | Ocorrências |
|---|---:|
| `literal_fixo` | 68 |
| `custom` (escape hatch) | 65 |
| `numerico_branco` | 10 |
| `dominio` | **0** |
| `modulo_11` | **0** |
| `coerencia_registro` | **0** |

**45% das regras já caem no escape hatch**, e os três arquétipos que a #2 e a #3 precisam usar
(`dominio`, `modulo_11`, `coerencia_registro`) nunca foram exercitados. Isto não aparece em nenhuma
issue aberta e é tratado na Onda 0.5 abaixo.

---

## 2. Causas-raiz — são quatro, não uma

### CR1 — O walker não recursa no `consequent` (confirmada, é a #1)

`tools/spec-extractor/src/ast-walker.ts:79-116`: o `case "IfStatement"` extrai a mensagem do
`consequent`, recursa no `alternate`, e **nunca visita o `consequent` como sentença**. Toda regra
aninhada dentro do bloco de outra é invisível.

### CR2 — Aninhamento no fonte é conjunção, não sequência (não está na #1, e é o risco maior)

O fonte oficial expressa domínio negado por **encadeamento de `if` aninhados sem `else`**: cada nível
testa a mesma posição contra mais um valor, e só o nível mais interno emite a mensagem. Dois exemplos
verificados em `assets/.../multipag/arquivoMultipag.js`:

- linhas 1264-1268 — câmara centralizadora, Segmento A colunas 018-020: **4 níveis** aninhados
  contra 4 valores, uma única mensagem.
- linhas 1313-1325 — dígito da conta do favorecido, colunas 042-042: **12 níveis** aninhados,
  uma única mensagem.

Recursar ingenuamente no `consequent` produziria **4 regras onde existe 1**, e **12 onde existe 1** —
cada uma reprovando isoladamente um arquivo correto. A CA5 da #1 já antecipa isto: *"regra extraída
errada é pior que regra ausente, porque reprova arquivo correto."*

⇒ A correção da #1 **não é** "adicionar uma linha de recursão". É pilha de guardas + fusão de cadeia.

### CR3 — Não há discriminador entre regra e renderização de relatório

O fonte acumula **relatório e erro na mesma variável**: 594 atribuições de acumulação em
`arquivoMultipag.js`, das quais 513 carregam referência de linha (candidatas a regra) e o resto é
render de relatório (dados da empresa, cabeçalho de tabela, texto de continuação). O extrator hoje
captura render como regra — é a origem dos 22 registros `nao-classificado` (CA3 da #1).

**Discriminador proposto:** só vira regra a mensagem que casa **referência de linha + referência de
coluna**. O resto é marcado `natureza: "renderizacao"` e fica fora do spec de regras.

### CR4 — O walker não entra em `FunctionDeclaration` aninhada (bloqueia a #4)

`visitStatement` trata `IfStatement`, `For`, `While` e `BlockStatement`. Não trata declaração de
função interna. No fonte de retorno, o catálogo de ocorrências vive numa função **aninhada** dentro da
função de layout (`assets/.../retorno/arquivoRetorno.js:7891`, dentro de `retorno_multipag_folha240`
declarada em `:7672`). Sem CR4 resolvida, a #4 é inalcançável por extração — e o DoD dela exige
"geradas pelo extrator".

### CR5 — A DSL não modela a comparação frouxa do JavaScript (achado novo, ver §3)

---

## 3. Achado novo que muda a Fase 1 (Rust): comparação frouxa

O fonte oficial compara **string contra número** com `==` / `!=` / `>=`, disparando coerção do
JavaScript. Casos verificados em `arquivoMultipag.js`:

| Local | Forma | Consequência |
|---|---|---|
| `:1283` | posição comparada a literal numérico sem aspas | campo em branco **passa** na comparação (`Number("") === 0`) |
| `:1279` vs `:1281` | mesma posição comparada ora com aspas, ora sem | dois caminhos de comparação diferentes na mesma faixa |
| `:1307` | posição comparada com `>=` a número | comparação relacional com coerção, não lexicográfica |
| `:1348`, `:1390` | dígito comparado a resultado numérico do cálculo | branco equivale a dígito `0` |

**Por que importa agora:** a Fase 1 vai reimplementar isto em Rust comparando `&[u8]` (§ "Encoding e
comparação de bytes" do design doc). Comparação de bytes **não reproduz** a coerção — o motor Rust
reprovaria arquivo que o validador oficial aprova, e vice-versa. É divergência silenciosa, exatamente
o que o épico #5 diz que este repositório existe para evitar.

⇒ **A DSL precisa de um campo por regra registrando o modo de comparação** (`estrita` vs `frouxa`),
capturado pelo extrator a partir da presença ou ausência de aspas no literal do fonte. Sem isso, o
contrato dos specs está incompleto e a Fase 1 herda o defeito.

---

## 4. Plano por ondas

### Onda 0 — Destravar a extração (issue #1) · tamanho M · **bloqueia tudo**

| # | Tarefa | Arquivos |
|---|---|---|
| 0.1 | Fixtures sintéticas dos padrões reais: cadeia aninhada de 4 níveis, cadeia de 12 níveis, guarda de bloco (`if (tipo registro) { ...regras... }`), e um caso de render puro | `tests/fixtures/sample-aninhado.js` |
| 0.2 | Pilha de guardas: `visitStatement` passa `guards: Guard[]`; ao emitir regra, grava `condicao_guarda` (conjunção das condições dos `if` externos) | `src/ast-walker.ts` |
| 0.3 | Fusão de cadeia → `dominio`: níveis consecutivos sobre **mesma posição e mesmo alvo**, todos com operador de desigualdade, cujo `consequent` é apenas o próximo `if`, colapsam numa condição de domínio com a lista de valores | `src/ast-walker.ts`, `src/rule-mapper.ts` |
| 0.4 | Discriminador sinal/ruído (CR3, fecha CA3) | `src/ast-walker.ts` |
| 0.5 | Registro inferido pela guarda, não só pela mensagem — a guarda de tipo de registro (posição 008 do fonte) identifica header de lote / detalhe / trailer mesmo quando a mensagem não nomeia | `src/ast-walker.ts` |
| 0.6 | Teste **de propriedade** (CA4): "existe ≥1 regra para cada tipo de registro do layout" e "nenhuma regra com `registro` nulo **e** `colunas` nulo". Nenhuma asserção de contagem | `tests/ast-walker.test.ts`, novo `tests/propriedades.test.ts` |
| 0.7 | Regenerar specs, **revisar o diff manualmente** (CA5), commit | `tools/specs/**` |

**Critério de saída da onda:** `tools/specs/layouts/multipag.json` contém regras de Segmento A,
header de lote e trailer; a suíte de propriedade passa; o diff foi revisado por humano.

**Escopo:** a correção é no walker, logo os três layouts são regerados juntos — a revisão do diff é
que pode ser priorizada por Multipag primeiro.

---

### Onda 0.5 — Qualidade da DSL (issue #6) · tamanho M

Sem esta onda, o volume de regras sai de 143 para ~1.500 e a proporção de `custom` (hoje 45%) vira o
produto: um spec majoritariamente inexecutável, que empurra todo o trabalho para funções manuais em
Rust — o oposto do "motor declarativo" do design doc.

| # | Tarefa | Detalhe |
|---|---|---|
| 0.5.1 | Matcher `dominio` | consome a saída da fusão da 0.3 |
| 0.5.2 | Matcher `numerico_branco` completo | a forma real do fonte combina teste de não-numérico com normalização de espaços; hoje só o caso simples casa |
| 0.5.3 | Matcher `coerencia_registro` | alvos relativos ao índice corrente (`+1`, `+2`); necessário para "banco único por lote" (#2 CA3) |
| 0.5.4 | Matcher `modulo_11` | pré-requisito da #3 |
| 0.5.5 | **Modo de comparação** (`estrita` / `frouxa`) por regra | §3 — muda o contrato dos specs |
| 0.5.6 | Resolução de alvo | o fonte lê por um índice e numera a mensagem por outro; hoje `alvo` pega o primeiro `res[...]` que aparecer, o que erra em regra de coerência |
| 0.5.7 | Meta de qualidade | `custom` ≤ 20% das regras após regeneração, medido por teste |

**Contrato:** `condicao_original` permanece intacto em toda regra, inclusive nas fundidas — a
rastreabilidade ao fonte é o que sustenta o princípio "regra extraída, nunca escrita à mão".

⇒ Aberta como **#6** — depende da #1, bloqueia #2 e #3.

---

### Onda 1 — As regras que viram gate (issues #2 e #3) · tamanho M + S

#### #2 — Segmento A e header de lote

Alvos localizados no fonte (`arquivoMultipag.js`):

| Regra da issue | Onde | Arquétipo esperado |
|---|---|---|
| Câmara P001 × banco do favorecido (CA2) | `:1264-1284`, colunas 018-020 e 021-023 | `dominio` + guarda de banco |
| Banco único por lote (CA3) | `:1296-1299`, alvo relativo `+2` | `coerencia_registro` |
| G012 em branco (CA4) | `:1419`, coluna 043 | `literal_fixo` |
| Forma de lançamento × tipo de serviço (CA1) | header de lote, a mapear na Onda 0 | `dominio` sob guarda |

**Nota de escopo confirmada:** as formas de PIX não aparecem no domínio aceito pelo módulo Multipag
deste corpus. Consistente com a hipótese da issue de que o módulo público antecede a versão do layout
com PIX. **PIX fora do primeiro release**, e o spec deve registrar a ausência explicitamente para que
o consumidor não conclua "não suportado pelo banco".

#### #3 — Módulo 11 de agência e conta

Localizado em `arquivoMultipag.js:1330-1412`, sob guarda de banco do favorecido igual ao próprio banco
(colunas 021-023). Parâmetros a extrair:

- **Dígito de agência** — colunas 025-028, pesos decrescentes 5·4·3·2, dígito na coluna 029.
- **Dígito de conta** — colunas 035-041, pesos 2·7·6·5·4·3·2, dígito na coluna 042.
- **Tratamento de resto** — resto 0 → dígito 0; resto > 1 → 11 − resto; **resto 1 → ver abaixo**.

⚠️ **Achado de fidelidade, não documentado em lugar nenhum:** o fonte **bifurca o algoritmo pelo
dígito que o arquivo informou**. Quando o resto é 1, o valor esperado é `0` no ramo em que o arquivo
informou algo diferente do caractere alternativo, e o caractere alternativo no ramo em que o arquivo o
informou. Efeito líquido: **com resto 1, o validador aceita ambos**. Uma reimplementação "correta"
escolheria um só e reprovaria arquivo que o oficial aprova. O spec precisa registrar `resto 1 → {0, P}`,
não um valor único.

- **Caixa baixa** — colunas 029 e 042 rejeitam o caractere alternativo minúsculo (`:1416-1418`).
- **Fronteira (CA3)** — fora do próprio banco, o dígito **não** é verificado na remessa. O spec deve
  dizer isto explicitamente, senão a regra vira armadilha.
- **CA4** — expor como função utilizável sobre um par agência/conta, não só como asserção sobre arquivo.

**Entrega paralela permitida pelo épico:** a versão manual destas regras cabe num teste de regressão
do emissor do core-api **hoje**, sem esperar o extrator. Fazer as duas, com a manual marcada como
temporária e ligada a esta issue — o risco declarado no épico é a manual virar permanente.

#### Decisão tomada — como fechar CA5/CA6 da #2

As CA5/CA6 dizem "*Quando validado, Então é reprovado/aprovado*". **Não existe motor de validação
neste repositório** — os crates Rust são Fase 1+. Três caminhos foram avaliados:

| Opção | Custo | O que entrega |
|---|---|---|
| **A. Runner de conformidade em TS** dentro do extrator: aplica o spec a um arquivo e devolve achados | baixo | Fecha CA5/CA6 agora; torna todo spec executável e vira harness de regressão para a Fase 1 Rust |
| B. Antecipar `cnab-core` em Rust | alto | Fecha CA5/CA6 com o motor definitivo, mas puxa a Fase 1 para dentro da Fase 0 |
| C. Golden test via Playwright contra o validador oficial | médio | Mede fidelidade contra a fonte real, mas depende de rede e não valida o *spec*, valida o site |

✅ **Decidido em 2026-08-19: opção A** — aberta como **issue #8** —, com C na Onda 3 como aferição
complementar de fidelidade. A é o caminho mais curto para o marco do épico e produz o oráculo que a
Fase 1 vai precisar de qualquer forma.

**Fronteira explícita do runner**, para não virar produto por acidente: ele é **oráculo de teste**,
não validador. Sem CLI pública, sem API, sem detecção de layout, sem tratamento de encoding — recebe
layout e arquivo já resolvidos e devolve achados. O validador é a Fase 1, em Rust. Quando `cnab-core`
existir, os dois rodam sobre o mesmo corpus e o diff entre eles é o teste de paridade.

---

### Onda 2 — Retorno (issue #4) · tamanho M

O fonte de retorno **não tem a forma "condição → mensagem de erro"**. Tem a forma "campo igual a
código → rótulo": é uma **tabela de domínio**, não uma regra. Isso exige um **segundo modo de
extração** no walker, e é a razão de o arquivo ter 32.981 linhas e apenas 34 mensagens de erro.

Verificado em `assets/.../retorno/arquivoRetorno.js`:

- Função de layout `retorno_multipag_folha240` em `:7672`; catálogo de ocorrências na função
  **aninhada** em `:7891` (⇒ depende de CR4).
- Campo de ocorrências: **colunas 231-240**, lido em fatias de 2 — **5 códigos**, confirmando a
  segunda armadilha da issue. O primeiro slot sozinho tem **143** ramos de decodificação.
- Códigos fora do domínio numérico presentes no validador (as divergências de que a issue fala) já
  aparecem nos primeiros ramos do catálogo.

| # | Tarefa |
|---|---|
| 2.1 | Suportar `FunctionDeclaration` aninhada no walker (CR4) |
| 2.2 | Modo de extração "tabela de domínio": `posição == código → rótulo` vira entrada de dicionário, não regra |
| 2.3 | Extrair os 5 slots do campo de ocorrências como fatias independentes (CA2) |
| 2.4 | Registrar em que tipos de registro o campo é lido — inclusive header e trailer — e quais são pulados (CA1, a propriedade mais importante da issue) |
| 2.5 | Balde explícito de código desconhecido (CA4) |
| 2.6 | `tools/specs/divergencias.json` — catálogo manual × validador, consumível por outros repositórios. É a saída de maior valor da fase segundo o épico |
| 2.7 | Adicionar `retorno-multipag` a `LAYOUTS_DO_CICLO`, `MAPEAMENTO_FUNCOES` e `LAYOUTS` — `config.ts` é a fonte da verdade do escopo |

---

### Onda 3 — Infra e gate automático (issue #7) · tamanho S

Não existe `.github/` no repositório: nada roda em CI hoje.

| # | Tarefa |
|---|---|
| 3.1 | Workflow de CI: `bun install`, `bun run typecheck`, `bun test` |
| 3.2 | Job de reprodutibilidade: regerar specs a partir de `assets/` versionadas em fixture e falhar se o diff não for vazio — sustenta o invariante de determinismo do `id` |
| 3.3 | Ativar o baseline SHA-256 como alerta: o hash já é gravado (`assets/baseline.json`, não versionado), falta comparar e avisar |
| 3.4 | Milestone "Fase 0" e labels `onda-0`…`onda-3` para as 5 issues + as 3 novas |
| 3.5 | Golden test Playwright contra o validador oficial (opção C da §4/Onda 1) |

---

## 5. Ordem de execução

```
Onda 0    #1                       ──┐
Onda 0.5  #6                       ──┤  sequenciais, uma destrava a outra
Onda 1    #2 · #3 · #8 (paralelas) ──┤
Onda 2    #4                       ──┘
Onda 3    #7 ───────────────────────── independente, pode começar a qualquer momento
```

Duas frentes podem começar **hoje**, sem esperar a Onda 0:
- a versão manual das regras da #2/#3 como teste de regressão do emissor do core-api (exceção
  autorizada pelo épico, com prazo de validade);
- a Onda 3 (CI), que é independente do walker.

## 6. Movimentações nas issues — executadas em 2026-08-19

| Estado | Item |
|---|---|
| ✅ Criada | **#6** — "DSL: fechar os arquétipos e modelar a comparação frouxa" · `onda-0.5` |
| ✅ Criada | **#7** — "CI: pipeline, reprodutibilidade dos specs e alerta de baseline" · `onda-3` |
| ✅ Criada | **#8** — "Runner de conformidade em TS: tornar o spec executável antes do motor Rust existir" · `onda-1` |
| ✅ Comentada | **#1** — CR2 (aninhamento é conjunção), evidência de 4 e 12 níveis, CA6 sugerido, e o sintoma nos três layouts |
| ✅ Comentada | **#3** — bifurcação do resto 1 → `{0, P}`, parâmetros localizados, e a coerção no comparativo do dígito |
| ✅ Comentada | **#5** — diagnóstico ampliado, quatro causas-raiz, comparação frouxa e ordem atualizada |
| ✅ Milestone | "Fase 0 — extrator vira gate" aplicada a #1–#8 |
| ✅ Labels | `onda-0` (#1), `onda-0.5` (#6), `onda-1` (#2, #3, #8), `onda-2` (#4), `onda-3` (#7) |
| ⬜ Pendente | Marcar `2026-08-18-fase-0-extrator-de-regras.md` como superado — o código foi além dele e os checkboxes nunca foram marcados |

### Mapa final da fase

| Onda | Issues |
|---|---|
| 0 | #1 |
| 0.5 | #6 |
| 1 | #2 · #3 · #8 |
| 2 | #4 |
| 3 | #7 *(independente — pode começar já)* |
| épico | #5 |

---

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Recursão ingênua gera regra falsa que reprova arquivo correto | CR2 tratada explicitamente na 0.3; CA5 da #1 exige revisão humana do diff |
| Volume de ~1.500 regras torna a revisão do diff impraticável | Revisar por tipo de registro e por arquétipo, não regra a regra; teste de propriedade como rede |
| `custom` domina o spec e a Fase 1 vira código manual | Meta de ≤20% medida por teste (0.5.7) |
| Motor Rust diverge do oficial por comparação de bytes | Modo de comparação no spec (§3) + golden tests (3.5) |
| Assets do banco mudam no meio da fase | Baseline SHA-256 ativo (3.3); `assets/` já é reproduzível por `bun run dev` |
