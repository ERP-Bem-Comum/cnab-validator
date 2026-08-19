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
| 0.6b | Propriedade adicional, nascida do defeito 1 abaixo: **nenhum registro contradiz a guarda que o cerca** | `tests/propriedades.test.ts` |
| 0.7 | Regenerar specs, **revisar o diff manualmente** (CA5), commit | `tools/specs/**` |

**Critério de saída da onda:** `tools/specs/layouts/multipag.json` contém regras de Segmento A,
header de lote e trailer; a suíte de propriedade passa; o diff foi revisado por humano.

**Escopo:** a correção é no walker, logo os três layouts são regerados juntos — a revisão do diff é
que pode ser priorizada por Multipag primeiro.

**Status em 2026-08-19 — 0.2 a 0.6 entregues.** 0.2 (pilha de guardas) e 0.3 (fusão de cadeia) vieram
no commit `51a0459`; 0.4, 0.5 e 0.6 nesta rodada. Medição depois × antes, mesmo corpus, mesmo conjunto
de regras (637 / 280 / 488 — nenhuma regra ganha ou perdida, só reclassificada):

| Métrica | cobrança | folha | multipag |
|---|---|---|---|
| `nao-classificado` | 511 → 9 | 39 → 6 | 16 → 5 |
| `custom` | 97% → 59% | 88% → 51% | 96% → 61% |
| `coerencia_registro` | 0 → 78 | 0 → 4 | 0 → 12 |
| colunas erradas | 595 → 194 | 216 → 73 | 434 → 168 |

Quatro defeitos encontrados na execução, além do previsto pela CR3:

1. **Classificação por texto sem desempate** — `inferirRegistro` devolvia o primeiro sinônimo na ordem
   do dicionário. "Segmento J-52" era engolido por "segmento J" (30 regras do multipag) e
   "Header de lote … divergente do Header de arquivo" ia para `header-arquivo`. Eram justamente as
   regras de coerência entre registros, escondidas sob rótulo errado. Corrigido por ordem posicional
   no texto + termo mais longo no empate; o segundo registro citado virou `registro_referenciado`.
2. **Taxonomia monoglota** — o dicionário só falava CNAB 240. `validarDadosArquivo400` tinha 276 de
   308 regras sem registro. Resolvido com `FAMILIA_POR_FUNCAO` em `config.ts`.
3. **Colunas erradas em 91% das regras** — regressão da 0.2: `condicao_original` virou conjunção e o
   extrator de posição passou a ler a guarda em vez do teste próprio. Resolvido separando
   `condicao_propria` de `condicao_guarda`. As divergências restantes são legítimas (mensagem reporta
   o campo, condição testa o dígito) e agora ficam em `colunas_mensagem`.
4. **Mensagem perdia a referência de linha** — `"Linha " + i + ", colunas…"` virava `"Linha ,"`.
   Agora emite `{linha}`; o acumulador `str` da concatenação é descartado.

5. **A fusão de cadeia depende da conjunção completa** — trocar a classificação para a condição
   própria derrubou `dominio` de 6 para 1 no repositório, porque a cadeia aninhada só existe na
   conjunção. Resolvido tentando `inferirDominio` sobre `condicao_original` antes; travado por teste
   nos dois sentidos (funde quando é a mesma posição, não funde quando a guarda testa outra).

Efeito colateral esperado: classificar pela condição própria destravou também os matchers de
`literal_fixo` e `numerico_branco`, que a conjunção com guardas impedia de casar. Isso adianta parte
da 0.5.7 — `custom` caiu de ~94% para ~58%, ainda acima da meta de 20%.

✅ **0.7 feita em 2026-08-19**, junto com a regeneração da Onda 0.5. Revisão por tipo de registro e
por arquétipo, via `src/diff-summary.ts` e matriz de transição sobre os 1.405 ids:

- **Nenhuma regra criada ou perdida** (`+0 / -0` em todos os layouts): as 449 alterações são todas
  reclassificação de arquétipo.
- Matriz de transição sem regressão — nenhum arquétipo específico voltou para `custom`. As transições
  são `custom → numerico_branco` (178), `custom → disjuncao` (155), `literal_fixo → dominio` (109),
  `custom → dominio` (7).
- Amostras conferidas contra o fonte, uma por transição e por família de layout: código de movimento
  do Segmento P (cobrança 240, colunas 016-017, 37 valores, comparação frouxa), dígito da conta
  (colunas 036, domínio que aceita `P` e `p`), carteira (colunas 038-040, 23 valores), tipo de serviço
  e modalidade do header de lote Multipag (31 valores cada), código de desconto do Segmento R
  (domínio **proibido** sob guarda de coerência com `res[i - 2]`), e as disjunções de conta e de
  quantidade de lotes.
- 59 regras tiveram `colunas` alteradas — **todas** disjunções, onde a faixa passou a ser o envelope
  das partes em vez da primeira faixa encontrada. 105 regras publicam mais de uma posição.

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

**Status em 2026-08-19 — 0.5.1, 0.5.2 e 0.5.5 entregues.** Medição sobre o mesmo corpus, mesmas
1.405 regras:

| Arquétipo | Antes | Depois |
|---|---:|---:|
| `custom` | 823 (58,6%) | **483 (34,4%)** |
| `numerico_branco` | 96 | 274 |
| `literal_fixo` | 377 | 268 |
| `disjuncao` (novo) | — | 155 |
| `dominio` | 7 | 123 |
| `coerencia_registro` | 94 | 94 |
| `tamanho_linha` | 8 | 8 |

O que mudou no matcher:

- **0.5.1 `dominio`** — passou a reconhecer as três formas que o fonte usa: desigualdade encadeada,
  negação de igualdade (`!(x == 01)`) e literal numérico sem aspas. Ganhou `sentido`, porque o fonte
  também escreve o domínio ao contrário, como disjunção de igualdades (valores **proibidos**). A
  fusão de cadeia deixou de exigir que toda a conjunção fosse da mesma posição: as cláusulas que
  sobram são toleradas **apenas** quando são guardas já publicadas em `condicao_guarda`, e nenhuma
  delas pode tocar a faixa do domínio.
- **0.5.2 `numerico_branco`** — as três variantes do teste residual (`/\s/ == 0`, `/\s/ != 0`,
  `/\d/ == 1`) eram colapsadas num arquétipo só, sem distinção. Duas delas pedem coisas **opostas**
  (uma exige campo numérico preenchido, a outra exige branco): um motor não conseguiria implementar a
  regra a partir do spec. Agora cada regra carrega `exige` e o `residuo` literal.
- **Arquétipo novo `disjuncao`** — o fonte cobre várias faixas com um `||` e uma única mensagem
  (conta testada caractere a caractere, data quebrada em pedaços). Antes isso era `custom` e a regra
  publicava só a primeira faixa; agora publica todas, com `colunas` como envelope.
- **0.5.5 modo de comparação** — `comparacao` (`estrita` | `frouxa`) em `literal_fixo` e `dominio`,
  derivado da presença de aspas no literal do fonte. É o campo que impede a Fase 1 em Rust de
  divergir do validador oficial por comparar bytes onde o JavaScript coage tipos.

**Status em 2026-08-19 (segunda rodada) — onda 0.5 fechada.** `custom` foi de 483 (34,4%) para
**52 (3,7%)**, contra a meta de 20%. Mesmas 1.405 regras, nenhuma criada ou perdida: as 431
alterações são todas `custom → arquétipo`.

| Arquétipo | Antes | Depois |
|---|---:|---:|
| `custom` | 483 (34,4%) | **52 (3,7%)** |
| `numerico_branco` | 274 | 274 |
| `literal_fixo` | 268 | 268 |
| `disjuncao` | 155 | 185 |
| `conjuncao` (novo) | — | 175 |
| `modulo_11` | 0 | **140** |
| `dominio` | 123 | 123 |
| `coerencia_registro` | 94 | 94 |
| `intervalo` (novo) | — | 86 |

- **0.5.4 `modulo_11`** — exigiu rastrear variável, não só casar regex: o walker passou a manter um
  ambiente de atribuições (`RawRule.ambiente`) com a pilha de guardas de cada uma. Uma atribuição só
  alcança a regra se toda guarda da regra vale também para ela — o fonte **repete o bloco de cálculo
  inteiro para cada valor informado no dígito**, e sem esse escopo o ramo irmão vazaria, publicando
  dois resultados contraditórios para o mesmo resto. O matcher especulativo que procurava uma chamada
  `calcularModulo11(...)` dentro da própria condição foi removido: nunca casou em nenhuma das 1.405
  regras, e o arquétipo que ele produzia não tinha base nem resultado.
- **0.5.3 `coerencia_registro` com alvo relativo** — já funcionava; a medição confirma `res[i - 1]`
  (30), `res[i - 2]` (27), `res[j]` (23), `res[0]` (5), `res[i - 4]` (4), `res[i - 3]` (4) e
  `res[i + 2]` (1).
- **0.5.6 resolução de alvo** — medido, sem defeito observável: em **zero** das 1.405 regras o alvo
  publicado difere do alvo que a condição lê. O que existe é a mensagem numerando a linha por outro
  índice (`{valor}` em vez de `{linha}`, 104 regras com alvo `res[j]`), o que é questão de mensagem,
  não de alvo.
- **0.5.7 meta de qualidade** — virou teste (`tests/propriedades.test.ts`), medido sobre os specs
  versionados.
- **Arquétipos novos** — `intervalo` (comparação relacional, incluindo o `>= 'a' && <= 'z'` que
  rejeita minúscula) e `conjuncao` (espelho da `disjuncao`, para a combinação proibida entre campos).

**Achados de fidelidade desta rodada:**

1. **A bifurcação do resto não é só do Multipag, e não é sempre a mesma.** Na cobrança 240, o ramo em
   que o arquivo informou `P` no dígito da agência espera `P` **tanto no resto 0 quanto no resto 1**
   (`arquivoRemessa.js`, dv agência do Segmento P); no Multipag, o mesmo ramo espera `0` no resto 0 e
   `P` no resto 1. Uma reimplementação que escolha uma das duas divergiria de um dos layouts.
2. **O fonte tem `res[1]` onde deveria ter `res[i]`** na segunda metade do teste de caixa baixa do
   dígito da conta do Segmento P (cobrança 240, colunas 036). O extrator preserva: a regra é uma
   conjunção de dois `intervalo` com alvos diferentes, e o envelope de `colunas` cobre só o alvo da
   regra.
3. **O fonte usa `&` (bit a bit) no lugar de `&&`** em 6 regras, e tem um `isNaN(a || b)` com o
   parêntese fechado no lugar errado. Ambos ficam em `custom` de propósito — o comportamento não é o
   da conjunção lógica.

**Terceira rodada em 2026-08-19 — o discriminador de sinal (CR3/0.4) refeito.** A regra de banco
único por lote (CA3 da #2) não estava nos specs, e a causa não era o walker: `isNoise` decidia o que
é regra por **lista de palavras** na mensagem, e "Número do banco diferente no mesmo lote" não casa
nenhuma delas (a lista tem "divergent", não "diferente").

O critério do CR3 — referência de linha + referência de coluna — **também estava errado sozinho**:
medido contra o corpus, ele traria 134 regras novas mas **descartaria 27 regras legítimas**, entre
elas todas as de comprimento de registro (que não citam coluna por natureza), os domínios de tipo de
serviço e modalidade do Multipag (`{valor}-Serviço não localizado`) e as coerências aritméticas do
Segmento J. O discriminador passou a exigir **uma das duas evidências**, não as duas:

| Critério | Regras | Perdidas | Novas |
|---|---:|---:|---:|
| lista de palavras (antes) | 1.405 | — | — |
| linha + coluna (CR3 literal) | 1.512 | **27** | 134 |
| linha + coluna **ou** indicativo | **1.539** | **0** | **134** |

As 134 novas foram revisadas uma a uma pelo texto: são comparações de data (pagamento inferior à
gravação, desconto superior ao vencimento), percentual que excede o limite, código de banco, banco
`237` nas colunas 001-003 e sequencial de registro. Nenhum render de relatório entrou. Apareceu o
primeiro `segmento-j-52` do repositório.

Na mesma rodada, `coerencia_registro` passou a cobrir **comparação entre dois campos da mesma linha**
e **operador relacional** — é a forma com que o fonte compara datas entre si. Isso reclassificou 6
regras que estavam em `custom` e absorveu 68 das novas. `custom` fica em **65 de 1.539 (4,2%)**.

Diff da rodada: **+134 / -0 / ~6** — nenhuma regra perdida, e a única reclassificação é
`custom → coerencia_registro`.

⬜ Pendente fora desta onda: as 65 `custom` restantes são casos genuinamente irregulares — comparação
entre duas faixas do **mesmo** registro (6), totalizador com `parseFloat` somando campos (7),
variáveis de contagem (`qtde_reg != qtde_linha`, 3), os dois bugs do fonte acima, dígitos com dois
valores aceitos (`!= dv10 && != dv11`, 6) e aritmética sobre faixa (`faixa != outra - 1`).

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

**Status em 2026-08-19 — #2 fechada.** As quatro regras estão no spec, geradas pelo extrator, e cada
uma tem caso positivo e negativo executado pelo runner:

| CA | Regra | Onde ficou | Arquétipo |
|---|---|---|---|
| CA1 | Forma de lançamento restrita por tipo de serviço | header de lote, colunas 012-013 | `dominio` com 10 valores aceitos, sob guarda do serviço 20 |
| CA2 | Câmara P001 × banco do favorecido | Segmento A, colunas 018-020 e 021-023 | `conjuncao` — dependência cruzada, não domínio simples |
| CA3 | Banco único por lote | Segmento A, colunas 021-023 | `conjuncao` sobre `res[i]` e `res[i + 2]` |
| CA4 | G012 em branco | Segmento A, coluna 043 | `literal_fixo` com `!= " "` |
| CA5/CA6 | Reprovado com defeito, aprovado sem | corpus sintético | fechadas pelo runner (#8) |

Duas correções no extrator saíram daqui, e valem além da issue:

1. **A cadeia de domínio não era vista quando o fonte a parentiza.** O split de conjunção parava no
   primeiro nível, então `(A == 20 && B != 01) && (A == 20 && B != 02)` chegava ao matcher como duas
   cláusulas opacas. Achatando a conjunção, a restrição de forma de lançamento passou a sair como
   `dominio` **com a lista de valores aceitos** — que é literalmente o que a CA1 pede —, e mais 6
   regras saíram de `conjuncao` para `dominio`.
2. **As colunas publicadas vinham da primeira `substring` do texto, não da faixa que o arquétipo
   validou.** Numa condição que lê dois campos, isso apontava o campo de referência em vez do
   validado: as regras de data do desconto apontavam as colunas do vencimento. Corrigido em 10
   regras, todas conferidas contra a mensagem do fonte.

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

**Entregue em 2026-08-19 (`src/runner/`).** As CA5 e CA6 da #2 estão fechadas por teste executável:

- `multipag-correto.txt` (crédito em conta, câmara `000`, favorecido no `237`) → **nenhum achado**,
  sobre as 512 regras do spec do Multipag.
- `multipag-camara-invalida.txt`, que difere do anterior em **um único campo** (câmara `018`, TED,
  mantendo o favorecido no próprio banco) → **reprovado**, com o achado apontando Segmento A,
  colunas 018 a 020. Os outros dois achados que aparecem são consequência real do TED (código de
  finalidade obrigatório), não ruído.

O corpus foi construído usando o próprio runner como oráculo: cada campo foi preenchido até o
relatório sobre o arquivo correto ficar vazio. Isso significa que **o arquivo sintético satisfaz de
fato as regras extraídas** — não é um arquivo que passa porque as regras não rodam.

Três decisões de projeto que valem registro:

1. **As guardas não estão na DSL, então precisam de um avaliador próprio.** `src/runner/expressao.ts`
   é um parser de escopo fechado que reconhece as formas do fonte e **recusa** o resto. Os operadores
   são aplicados com os do próprio JavaScript: a coerção é o comportamento a reproduzir, não um
   defeito a corrigir.
2. **As quatro variáveis de posicionamento do fonte são booleanas, não índices.** `Header_arquivo =
   res[i].substring(3, 17) == 0` é "a linha corrente é o header". Isso explica
   `Header_arquivo < i > Trailer_arquivo`, que o JavaScript avalia como `(bool < i) > bool`, com duas
   coerções: o efeito líquido é "não é trailer, e não é a primeira linha". Funciona quase como a
   intenção, por acidente.
3. **Nada é aprovado por omissão.** 22 regras do Multipag têm guarda que referencia variável de
   dígito calculada (`dv1`, `resto10`, `obterValorCNPJAlfanumerico`) — o spec carrega esse ambiente
   para a condição, não para a guarda. Elas são reportadas como *não avaliadas*, com contagem, nunca
   como aprovadas. Fechar esse buraco é publicar o ambiente da guarda no spec, e fica registrado
   aqui como próximo passo.

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

**Status em 2026-08-19 — onda entregue (2.1 a 2.7).** O layout `retorno-multipag` está no spec com
**12 campos e 278 códigos**; nenhuma regra de remessa mudou (o diff é puramente aditivo).

| Propriedade | Medição |
|---|---|
| Campo de ocorrências | colunas 231-240, **5 fatias** de dois dígitos, 142 códigos |
| Registros em que é lido | `header-arquivo`, `header-lote`, `trailer-lote`, `trailer-arquivo` |
| Balde de desconhecido | `fora_do_dominio: "desconhecido"` no próprio campo |
| Divergências | `BD` (semântica divergente) e `XX` (ausente no manual), com fatias e linha do fonte |

- **2.1 (CR4)** resolvida no extrator novo, não no walker de regras: o modo `tabelas` é outro
  percurso do AST, e entra em `FunctionDeclaration` aninhada — que é onde o catálogo vive. Mexer no
  walker de regras arriscaria as 1.539 regras de remessa sem necessidade.
- **2.3** as fatias são descobertas do fonte, não declaradas: contíguas, de mesma largura e com
  domínio quase igual. O limiar foi calibrado por medição — 0,99 entre fatias do campo de
  ocorrências, 0,48 entre dois campos vizinhos de mesma largura sem relação (tipo de serviço e forma
  de lançamento). Só o **nome** do campo é declarado, em `CAMPOS_NOMEADOS`.
- **2.4** `registros_lidos` sai das tabelas irmãs que decodificam a posição do tipo de registro no
  mesmo bloco do fonte — é evidência extraída, não afirmação nossa.
- **2.6** `divergencias.json` é curado em `src/divergencias.ts` (o manual não é código) mas
  **verificado contra a extração**: divergência sobre código que o validador não trata quebra a
  geração, o que impede o catálogo de envelhecer em silêncio quando o banco mexer no validador.
- O corpus de fixture do gate de reprodutibilidade ganhou uma função de retorno sintética, então o
  modo `tabelas` e o `divergencias.json` passam a ser cobertos pelo CI. `baseline.json` atualizado.

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
