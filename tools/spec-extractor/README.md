# Bradesco Spec Extractor

Extrai regras de validação dos assets públicos do validador Bradesco via AST.

## Uso

```bash
bun install
bun run dev
```

Saída em `../../specs/`.

## Limitações conhecidas

A extração de scripts inline usa regex sobre o HTML bruto para preservar a
numeração absoluta de linhas. Isso é suficiente para os assets atuais do
validador Bradesco, mas pode falhar em casos de borda como:

- Tags `<script>` dentro de comentários HTML.
- Atributos cujo valor contenha o caractere `>`.
- Strings `</script>` dentro de código JavaScript inline.

Se algum desses casos aparecer nos assets do banco, a extração deve ser
migrada para um parser HTML que exponha as posições raw dos nós.
