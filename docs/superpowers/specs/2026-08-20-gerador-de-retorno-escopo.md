# Escopo — gerador de arquivo de retorno Multipag

> **Status: esboço para decisão.** Não é plano de execução. As medições citadas foram feitas
> em 2026-08-20 sobre os specs versionados e o corpus local do banco.
>
> A §7 foi medida e fechada: duas questões o fonte responde, uma respondeu e **revelou um defeito no
> spec** (já corrigido), e duas dependem do manual. O maior risco do §9 caiu.

## 1. O problema

Não existe homologação no convênio Multipag: o que há é produção. Hoje não há como exercitar o
consumidor de retorno do core-api sem transmitir um arquivo de verdade — e transmissão real depende
de decisão humana, por regra da casa.

O efeito é que **metade do ciclo nunca é testada**. A remessa tem gate (este repositório) e tem
oráculo (o validador oficial rodando local). O retorno não tem nem um nem outro: o core-api lê um
formato que nunca viu chegar.

## 2. O que este componente é — e o que não é

**É** um gerador de arquivos de retorno **estruturalmente reais, dirigidos por cenário**: dada uma
remessa e a escolha de um desfecho por pagamento, produz o arquivo de retorno correspondente, com
códigos de ocorrência que existem no catálogo do banco.

**Não é** um simulador do Bradesco. Essa fronteira é dura e vale ser dita antes de qualquer estimativa:

> O JavaScript público do banco **valida remessa e decodifica retorno**. Ele não contém "dado este
> pagamento, o banco responde X" — saldo, agendamento, efetivação, recusa por conta inexistente. Essa
> lógica é do processamento interno, não é derivável do fonte, e nenhum trabalho no extrator a alcança.

Quem escolhe o desfecho é quem roda o gerador. O componente garante a **forma**, não a **previsão**.

Isso não o torna menos útil: o que quebra em integração de retorno é quase sempre forma — posição de
campo, código não tratado, ocorrência múltipla lida como única, envelope recusado que o consumidor
varre só no detalhe.

## 3. Por que é viável: dois achados que reduzem o escopo

### 3.1 Retorno é a remessa devolvida, não um arquivo novo

O gerador é uma **transformação** `remessa → retorno`, não uma geração do zero. A maior parte do
conteúdo (banco, lote, sequenciais, favorecido, valores, datas) vem da própria remessa e é copiada.

Isso elimina a parte cara: não é preciso saber escrever um registro CNAB 240 inteiro do nada.

### 3.2 A remessa marca **negativamente** o que pertence ao retorno

Este é o achado que dispensa o manual. O spec de remessa já publica, regra a regra, quais faixas o
validador **exige em branco por serem exclusivas do retorno**:

| Registro | Faixa | O que a regra da remessa diz |
|---|---|---|
| `header-lote` | 231-240 | "Códigos de ocorrência para retorno. Deixar em branco." |
| `segmento-a` | 231-240 | "exclusivo para código de retorno. Deixar em branco." |
| `segmento-j` | 231-240 | "Exclusivo para código de retorno. Deixar em branco." |
| `segmento-n` | 231-240 | "Códigos das ocorrências para retorno. Deixar em branco." |
| `segmento-o` | 231-240 | "Ocorrências de retorno. Deixar em branco." |
| `trailer-lote` | 231-240 | "códigos das ocorrências para retorno. Deixar em branco." |
| `segmento-a` | 155-162 | "Data real efetivação do pagamento em branco." |
| `segmento-a` | 163-177 | "Valor real efetivação do pagamento em branco." |

**As posições que o gerador preenche são exatamente as que a remessa proíbe.** São derivadas do spec
que já existe, não declaradas à mão — o que significa que acompanham o extrator quando o banco muda o
validador, pelo mesmo caminho de sempre.

E o dicionário do que escrever nelas também já existe: `retorno-multipag` traz **12 campos e 278
códigos**, com o campo de ocorrências (231-240) em **5 fatias de dois dígitos**, 142 códigos.

## 4. Escopo mínimo (v1)

| # | Item |
|---|---|
| 1 | Carregar uma remessa Multipag e identificar os registros (reusa a classificação do spec) |
| 2 | Derivar do spec de remessa as faixas "exclusivas do retorno" — não declarar à mão |
| 3 | Aplicar um **plano de cenário**: por pagamento, os códigos de ocorrência a emitir |
| 4 | Preencher efetivação (data e valor) quando o cenário for de pagamento efetivado |
| 5 | Recalcular o que o retorno muda no envelope — ocorrências de header/trailer |
| 6 | Emitir com **CRLF**, que é o que o banco exige e o que o consumidor vai receber |
| 7 | Verificar o resultado com o validador oficial de retorno (§6) |

O **plano de cenário** é a interface com quem usa. Forma provável: um arquivo declarativo que casa
pagamento (por sequencial ou por favorecido) com um desfecho nomeado — `efetivado`,
`recusado-conta-inexistente`, `recusado-saldo`, `agendado`. Cada desfecho vira uma tupla de até cinco
códigos de ocorrência, escolhidos do catálogo extraído.

Um punhado de cenários nomeados cobre o que o consumidor precisa exercitar. A lista exata é decisão de
produto, não deste componente.

## 5. Fora de escopo, e por quê

- **Prever o desfecho real.** §2.
- **Transporte.** É do `van-agent-dc`.
- **Processamento de negócio** — saldo, limite, agendamento, liquidação.
- **Outros layouts.** Multipag primeiro; cobrança e folha não têm nem corpus de remessa verificado
  contra o oficial, então gerar retorno para eles seria construir sobre o que ainda não foi medido.
- **Retorno "de verdade" para conferência de produção.** O arquivo gerado é de teste, e precisa ser
  impossível de confundir com um recebido do banco. Convenção de nome e um marcador acordado com o
  core-api.

## 6. Como se verifica — o oráculo já existe

Este é o ponto que dá confiança ao componente, e ele repete o padrão do `bun run golden`:

```
gerador → arquivo de retorno → arquivoRetorno.js do banco (local, node:vm) → decodificação
```

O corpus do banco em `assets/` inclui `retorno/arquivoRetorno.js`, com a função
`retorno_multipag_folha240`. Rodar o **decodificador oficial** sobre o arquivo gerado responde a
pergunta certa: *o banco leria isto como o cenário que pedimos?*

Critério de aceite: nenhum código cai no balde `desconhecido`, e as ocorrências decodificadas batem,
fatia a fatia, com o cenário declarado. Um gerador que produza arquivo bem-formado mas com código que
o banco não reconhece falha aqui — que é onde deve falhar.

Segundo oráculo, mais barato: **ida e volta**. O core-api lê o retorno gerado e o desfecho que ele
registra tem de ser o do cenário. Isso atravessa fronteira de repo e vira mensagem.

## 7. Questões abertas — medidas em 2026-08-20

As quatro foram medidas contra o fonte. Duas o fonte responde, uma respondeu **e revelou um defeito no
spec**, e uma ele não responde — o que também é resultado.

### Q1 — Ocorrências no detalhe · ✅ respondida, e era um defeito nosso

A guarda que cerca o catálogo no fonte é:

```js
if (res[i].substring(7,8) == "0" || == "1" || == "3" || == "5" || == "9") {
  if (res[i].substring(13,14) != "Z" && != "G" && != "H" && != "Y") {
    if (isNaN(res[i].substring(230,232)) || ...) {
```

O campo é lido em **tipo 0, 1, 3, 5 e 9** — inclusive o **3, o detalhe**. O spec publicava só header e
trailer porque `registros_lidos` era derivado da tabela irmã de rótulos, e ela nomeia 0, 1, 5 e 9 mas
**não o 3**: o fonte não rotula o detalhe ali porque o rótulo dele já saiu no bloco do segmento.

O spec dizia, na prática, "as ocorrências não são lidas no detalhe" — o contrário do que o fonte faz, e
exatamente o erro que faria um gerador escrever no lugar errado e um consumidor varrer só o envelope.
Corrigido: `registros_lidos` passou a usar a guarda como evidência primária, e **10 dos 12 campos**
melhoraram.

Fica registrado como fronteira: os segmentos **Z, G, H e Y não carregam ocorrência** — o fonte os exclui
explicitamente.

### Q2 — Nomes dos campos · ✅ respondida, não é bloqueio

Os campos se identificam pelos rótulos que o próprio fonte emite. `nome: null` significa que
`CAMPOS_NOMEADOS` declarou um, não que o campo seja desconhecido:

| Faixa | O que é, pelos rótulos do fonte |
|---|---|
| 008 | tipo de registro (`0=Header de Arquivo`…) |
| 010-011 | tipo de serviço (`01=Cobrança`…) |
| 012-013 | forma de lançamento (`01=Crédito em Conta Corrente`…) |
| 015 | tipo de movimento (`0=Inclusão`, `7=Liquidação`…) |
| 016-017 | código de instrução — **dois campos homônimos**, pagamento (14 códigos) e cobrança (36) |
| 018-020 | câmara centralizadora (`000`, `018=TED`, `700=DOC`, `888=TED ISPB`) |
| 020, 076, 132 | tipo de inscrição (CPF/CNPJ), em três registros |
| 229 | instrução de protesto |
| 231-240 | ocorrências |

O gerador indexa por id e posição, não por nome. Declarar em `CAMPOS_NOMEADOS` é ergonomia.

### Q3 — Sequencial e quantidade · ❌ o fonte não responde

O validador de retorno **não lê** sequencial (008-013) nem as quantidades do trailer (018-023,
024-029): zero ocorrências em toda a função. Ele decodifica códigos, não valida estrutura.

Consequência para o §6: **o oráculo tem um ponto cego aqui.** Qualquer escolha de sequencial passa pelo
decodificador oficial sem reclamação, porque ele não olha. Espelhar ou renumerar é informação do
manual, que vive no core-api — e é a única das quatro que precisa atravessar fronteira de repo.

### Q4 — Efetivação fora do Segmento A · ❌ o fonte não responde

O bloco do Segmento A no retorno lê até `132-134`; as faixas de efetivação (155-162 e 163-177) **não
são decodificadas** por ele, o que é coerente com ele traduzir códigos e não valores.

A informação que temos vem da **remessa**, que marca as duas faixas como "exclusivo para retorno" no
Segmento A — e não marca faixa equivalente em J, N ou O. O validador não confirma nem contradiz.

Para o v1 isso é suficiente: efetivação no Segmento A tem posição derivada do spec, e nos demais
segmentos o gerador **não escreve** em vez de adivinhar. Se for preciso, é pergunta ao core-api.

## 8. Onde vive

**Recomendação: neste repositório**, como um crate do workspace (`cnab-retorno`), ao lado de
`cnab-specs` e `cnab-core`.

O motivo é a fonte da verdade: o gerador é **derivado do spec**, exatamente como o motor. As faixas que
ele preenche saem do `tools/specs/`, e o oráculo dele é o mesmo corpus em `assets/`. Num repositório
que não tem o spec, as posições viram constantes copiadas — e constante copiada diverge do fonte na
primeira atualização do banco, que é o defeito que este repositório inteiro existe para não ter.

O `van-agent-dc` é transporte, em Go, numa máquina Windows; o core-api é o consumidor. Nenhum dos dois
tem o layout.

Consequência: o artefato que atravessa fronteira é o **arquivo gerado**, não o código.

## 9. Tamanho

Menor que a Fase 1 dos crates, e por uma razão específica: o conhecimento caro — posições, códigos,
classificação de registro — já está extraído e verificado. O que falta é transformação e cenário.

O risco não está no volume, está na §7 — e a medição mudou o quadro. O maior deles era escrever
ocorrência no registro errado, e ele **se confirmou**: o spec dizia que o detalhe não carrega
ocorrência. Corrigido antes de existir uma linha do gerador.

O que sobra é menor e conhecido: sequencial e efetivação fora do Segmento A dependem do manual, e o
oráculo do §6 **não cobre o sequencial**, porque o decodificador oficial não o lê. Para essas duas o
v1 escolhe não escrever em vez de adivinhar, e a pergunta vai ao core-api quando for necessária.

O oráculo continua vindo antes do primeiro cenário — só agora se sabe onde ele é cego.
