# Bradesco Spec Extractor

Extrai regras de validação dos assets públicos do validador Bradesco via AST.

## Uso

```bash
bun install
bun run dev
```

Saída em `../../specs/`.

## Runner de conformidade — oráculo de teste, não validador

`src/runner/` aplica um spec a um arquivo em memória e devolve os achados. Ele
existe para tornar o spec **executável** dentro da Fase 0, antes de o motor em
Rust existir: é assim que os critérios de aceite escritos como "quando validado,
então é reprovado/aprovado" podem ser fechados por teste.

**Não é um validador.** Sem CLI, sem API, sem detecção de layout, sem tratamento
de encoding: recebe layout e arquivo já resolvidos e devolve achados. Não é
distribuído nem documentado como ferramenta de uso externo. O validador é a
Fase 1, em Rust; quando `cnab-core` existir, os dois rodam sobre o mesmo corpus e
o diff entre eles é o teste de paridade — é aí que este runner paga o próprio
custo pela segunda vez.

Três garantias que ele precisa manter:

- **Nada é aprovado por omissão.** Condição `custom`, condição que depende de algo
  que o spec não carrega, e guarda que o avaliador não reconhece são reportadas
  como *não avaliadas*, com contagem. Regra silenciosamente ignorada cria falsa
  confiança.
- **Acesso fora dos limites devolve string vazia**, como o fonte, que não checa
  nada. Arquivo truncado produz relatório, não exceção.
- **A coerção do JavaScript é reproduzida, não corrigida.** Os operadores são
  aplicados com os operadores do próprio JavaScript, e as guardas são avaliadas
  por um parser de escopo fechado (`src/runner/expressao.ts`) que reconhece
  exatamente as formas do fonte e recusa o resto. O campo `comparacao` de cada
  regra é o que diz se a comparação é estrita ou frouxa. `&&` e `||`
  curto-circuitam, como no fonte: a guarda identifica o registro antes de comparar
  o dígito, e avaliar o lado que o validador nunca olha faria a regra ser recusada
  em toda linha do arquivo.

Guarda que referencia variável calculada (o dígito verificador) é resolvida pelo
campo `variaveis_guarda` do spec. O que não se calcula inteiro continua recusado:
o CNPJ alfanumérico passa por uma função do fonte que o spec não modela, e o
módulo 10 do Segmento O soma variáveis intermediárias com dobra condicional, que
nenhum arquétipo cobre. O relatório separa esses dois motivos.

Corpus em `tests/fixtures/corpus/`, com um README próprio descrevendo cada
arquivo campo a campo. É todo sintético.

## Dígito verificador de agência e conta

`src/digito-verificador.ts` expõe o cálculo de módulo 11 do validador **sobre um
par agência/conta**, sem precisar gerar arquivo. É o que permite auditar cadastro
direto, em vez de esperar retorno de remessa.

```ts
import { verificarPar } from "./src/digito-verificador.js";
const regras = JSON.parse(readFileSync("tools/specs/layouts/multipag.json", "utf-8")).regras;

verificarPar(
  { banco: "237", agencia: "01234", digito_agencia: "3",
    conta: "000000567890", digito_conta: "0" },
  regras
);
```

Nada ali é escrito à mão: pesos, módulo, tratamento de resto, a rejeição de caixa
baixa e a fronteira de banco saem das regras extraídas. Se o banco mudar o
algoritmo, o spec muda e a função muda junto — uma reimplementação manual
divergiria em silêncio.

Três comportamentos que surpreendem e são do validador, não escolha nossa:

- **No resto 1 o validador aceita dois dígitos.** O fonte repete o bloco de
  cálculo por valor informado: num ramo o resto 1 espera zero, no outro espera o
  caractere alternativo. Quem escolher um só reprova arquivo que o oficial aprova.
- **O caractere alternativo em caixa baixa é recusado**, embora o maiúsculo passe.
- **Fora do banco aplicável, o dígito não é verificado na remessa.** `aplicavel:
  false` não é "válido": é "o validador não julga isso aqui" — quem julga é a
  ocorrência de retorno.

## Política de retry

O downloader retrya automaticamente as seguintes condições:

- Códigos HTTP `408`, `429`, `500`, `502`, `503`, `504`.
- Erros cuja mensagem indique falha de rede/DNS/tempo de esgotamento,
  incluindo `fetch failed`, `ECONNREFUSED`, `ETIMEDOUT`, `getaddrinfo` e a
  mensagem real do Bun `Unable to connect. Is the computer able to access the url?`.

`retries` é o número de tentativas adicionais; o total de requisições é
`retries + 1`. Entre tentativas há backoff exponencial com cap de 30 s
(`Math.min(backoffMs * 2 ** attempt, 30000)`, default `backoffMs = 100 ms`).
Erros HTTP 4xx (exceto 408/429) e erros cuja mensagem não indique falha de
rede não geram retry.

## Golden test contra o validador oficial (`bun run golden`)

O validador do Bradesco é JavaScript que roda no navegador, não um serviço — o
oráculo não exige rede. `src/golden.ts` carrega o corpus já baixado em `assets/`
num contexto isolado (`node:vm`), executa a função de layout do próprio banco
sobre cada arquivo do corpus de teste e compara com o que o runner acusa.

É **local e opcional**: `assets/` não é versionado, e sem ele o script e os
testes se declaram pulados em vez de falhar. O CI continua sem tocar a rede do
banco (CA2 da issue #7).

O placar tem três colunas, e só uma derruba o script:

- **falso positivo** — o runner reprova o que o oficial aprova. Sempre defeito, e
  o único caso que falha: gate que reprova arquivo bom é pior que gate nenhum.
- **lacuna nova** — o oficial reprova e o runner não, sem causa registrada. É a
  fila de trabalho.
- **conhecida** — lacuna já explicada em `src/golden-conhecidas.ts`, com o porquê
  escrito por extenso. Entrar nessa lista exige entender a causa.

A comparação casa **template contra instância**: o fonte concatena variáveis na
mensagem e o extrator as preserva como `{valor}`, enquanto o validador emite o
texto já preenchido.

Duas coisas que este teste revelou sobre o fonte, e que valem para quem gera
arquivo:

- O validador **exige CRLF**. A checagem não olha as linhas — olha o hex do
  arquivo inteiro, que a página guarda antes de dividir. Por isso o corpus de
  teste usa CRLF: é o que o banco aceita.
- Ele **aborta** em arquivo truncado, lendo `res[j]` sem checar limite. No
  navegador a validação simplesmente não termina; o runner conclui e relata.

## Limitações conhecidas

A extração de scripts inline usa regex sobre o HTML bruto para preservar a
numeração absoluta de linhas. Isso é suficiente para os assets atuais do
validador Bradesco, mas pode falhar em casos de borda como:

- Tags `<script>` dentro de comentários HTML.
- Atributos cujo valor contenha o caractere `>`.
- Strings `</script>` dentro de código JavaScript inline.

Se algum desses casos aparecer nos assets do banco, a extração deve ser
migrada para um parser HTML que exponha as posições raw dos nós.
