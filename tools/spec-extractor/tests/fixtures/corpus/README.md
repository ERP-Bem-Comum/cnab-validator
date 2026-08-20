# Corpus sintético do runner de conformidade

Arquivos CNAB 240 do layout **Multipag**, usados pelos testes do runner
(`tests/runner.test.ts`). São **inteiramente sintéticos**: o CNPJ, a agência, a
conta, o nome da empresa e os valores foram inventados, e os dígitos
verificadores foram calculados pelo próprio algoritmo do spec para que os
arquivos sejam internamente coerentes. Nenhum dado real de cliente, empresa ou
conta aparece aqui — o repositório é público.

| Arquivo | Para quê |
|---|---|
| `multipag-correto.txt` | Arquivo conforme: crédito em conta (câmara `000`) com favorecido no Bradesco (`237`). O runner não produz nenhum achado sobre ele. |
| `multipag-camara-invalida.txt` | Idêntico ao anterior, com um único campo alterado: câmara `018` (TED) mantendo o favorecido no próprio banco. É o defeito que o gate precisa pegar. |
| `multipag-truncado.txt` | Header de arquivo íntegro e uma segunda linha cortada em 120 posições, sem lote nem trailer. Exercita o acesso fora dos limites. |
| `multipag-forma-lancamento-invalida.txt` | Header de lote com serviço de pagamento a fornecedor e forma de lançamento fora da lista que o validador aceita para esse serviço. Um campo diferente do correto. |
| `multipag-g012-preenchido.txt` | Segmento A com o dígito da agência do favorecido (coluna 043) preenchido, onde o validador exige branco. Um campo diferente do correto. |
| `multipag-banco-divergente-no-lote.txt` | Dois pares Segmento A/B no mesmo lote, com favorecidos em bancos diferentes. O segundo A usa a câmara de TED e os códigos de finalidade, que são o correto para banco de fora: o único defeito é a mistura de bancos. |
| `multipag-cpf-correto.txt` | Igual ao correto, com a empresa identificada por CPF sintético (inscrição `1`) em vez de CNPJ, com os dois dígitos verificadores certos. Nenhum achado. |
| `multipag-cpf-dv2-invalido.txt` | O mesmo CPF com o **segundo** dígito trocado e o primeiro intacto. Produz **dois** achados — header de arquivo e header de lote, que é onde a inscrição da empresa aparece. Antes de o spec publicar `variaveis_guarda`, este arquivo passava limpo: a regra do segundo dígito vive sob uma guarda que compara a faixa com o primeiro, e sem o cálculo publicado ela nunca era avaliada. |
| `multipag-trailer-lote-divergente.txt` | Um único byte diferente do correto: o trailer de lote declara `000005` registros onde o lote tem quatro. Produz **um** achado. É o arquivo que exercita o deslocamento da coerência (`substring(17, 23) - 2`) — enquanto essa regra ficava em `custom`, foi ela que deixou o corpus inteiro passar com trailer errado. |
| `multipag-trailer-arquivo-divergente.txt` | Um único byte diferente do correto: o trailer de arquivo declara `000007` registros onde o arquivo tem seis. Produz **um** achado. Exercita a comparação com a variável de fluxo (`qtde_linha = j`), a outra regra de trailer que ninguém avaliava. |

`multipag-forma-lancamento-invalida.txt`, `multipag-g012-preenchido.txt` e
`multipag-banco-divergente-no-lote.txt` existem para os critérios de aceite da
issue #2, e cada um produz **exatamente um achado** — o defeito injetado, nada
mais. O par de CPF é a exceção deliberada: o campo de inscrição é repetido no
header de lote, então um dígito errado é reprovado nas duas linhas, como o
validador oficial faz.

Estrutura de `multipag-correto.txt` (6 registros de 240 posições):

| Linha | Registro | Campos preenchidos |
|---|---|---|
| 1 | Header de arquivo | banco `237`, lote `0000`, tipo `0`, inscrição `2` (CNPJ), CNPJ sintético com os dois dígitos calculados, convênio, agência + dígito, conta + dígito, nome da empresa, remessa `1`, data, sequencial, versão `089`, densidade `01600` |
| 2 | Header de lote | lote `0001`, tipo `1`, operação `C`, serviço `20`, forma de lançamento `01`, versão do lote `045`, mesmos CNPJ/agência/conta do header de arquivo, endereço, forma de pagamento `01` |
| 3 | Segmento A | câmara `000`, banco favorecido `237`, agência/conta do favorecido, nome, data e valor do pagamento, campos de efetivação zerados |
| 4 | Segmento B | inscrição e CNPJ do favorecido, endereço, CEP, data de vencimento, valor do documento igual ao do Segmento A, abatimento/desconto/mora/multa zerados |
| 5 | Trailer de lote | quantidade de registros e somatório dos valores do lote |
| 6 | Trailer de arquivo | quantidade de lotes e de registros |

Os arquivos foram construídos com o próprio runner como oráculo: cada campo foi
preenchido até que o relatório sobre `multipag-correto.txt` ficasse vazio. Ao
mexer neles, rodar `bun test tests/runner.test.ts` — as contagens dos testes são
o que sustenta as CA5 e CA6 da issue #2.

**Todos usam CRLF**, porque é o que o validador oficial exige: ele checa o
delimitador pelo hex do arquivo inteiro, não pelas linhas já divididas. Com LF,
o validador reclama de uma linha por vez, do começo ao fim do arquivo.

O corpus passou a ser conferido também pelo `bun run golden`, que roda o
validador oficial sobre estes mesmos arquivos. Foi ele que mostrou que os
trailers estavam com contagem errada — o runner não avaliava essas duas regras,
então o corpus tinha sido dado por correto contra um oráculo incompleto. Hoje
`multipag-correto.txt` passa limpo pelos dois lados.
