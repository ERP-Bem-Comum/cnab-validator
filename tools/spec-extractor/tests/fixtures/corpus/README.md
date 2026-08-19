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
