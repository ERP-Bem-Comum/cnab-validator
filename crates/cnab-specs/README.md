# cnab-specs

Carrega os specs de `tools/specs/` em structs Rust. É o **consumidor do
contrato** — não valida arquivo nenhum: isso é do `cnab-core`, que consome o que
está aqui.

```rust
use cnab_specs::Catalogo;

let catalogo = Catalogo::carregar("tools/specs")?;
let multipag = catalogo.layout("multipag").expect("layout do ciclo");

for regra in multipag.regras_do_registro("segmento-a") {
    println!("{} — {}", regra.id, regra.mensagem);
}
```

## Por que ele falha em vez de tolerar

O spec é gerado por um extrator que evolui; o risco não é ele publicar algo
inválido, é publicar algo **novo** que ninguém deste lado leu. Um motor que
ignora campo desconhecido aprova arquivo que o banco reprova, sem sinal nenhum.
Daí duas escolhas:

- `deny_unknown_fields` em todas as structs — campo novo quebra a carga, o que
  força extrator e motor a andarem juntos.
- Nenhuma variante "desconhecida" em `Condicao` ou `VariavelDaGuarda` —
  arquétipo que este crate não conhece derruba a carga, pela mesma razão que o
  runner reporta *não avaliada* em vez de aprovar.

Os nomes seguem o JSON, que é em português. Traduzir aqui criaria um segundo
vocabulário para as mesmas coisas — e o vocabulário do spec já é o do fonte
oficial.

## Testes

`tests/contrato.rs` roda sobre os specs **versionados**, não sobre fixtures. São
invariantes estruturais, sem asserção de contagem: o número de regras muda a cada
melhoria do extrator, a forma não.
