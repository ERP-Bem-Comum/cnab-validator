# Bradesco Spec Extractor

Extrai regras de validação dos assets públicos do validador Bradesco via AST.

## Uso

```bash
bun install
bun run dev
```

Saída em `../../specs/`.

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

## Limitações conhecidas

A extração de scripts inline usa regex sobre o HTML bruto para preservar a
numeração absoluta de linhas. Isso é suficiente para os assets atuais do
validador Bradesco, mas pode falhar em casos de borda como:

- Tags `<script>` dentro de comentários HTML.
- Atributos cujo valor contenha o caractere `>`.
- Strings `</script>` dentro de código JavaScript inline.

Se algum desses casos aparecer nos assets do banco, a extração deve ser
migrada para um parser HTML que exponha as posições raw dos nós.
