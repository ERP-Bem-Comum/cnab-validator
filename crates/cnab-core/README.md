# cnab-core

Motor de validação dirigido pelos specs. Aplica um layout a um arquivo e devolve
os achados — sem I/O, sem detecção de layout, sem encoding: isso é da CLI e da
API, que vêm depois.

```rust
use cnab_core::{aplicar_spec, separar_linhas};
use cnab_specs::Catalogo;

let catalogo = Catalogo::carregar("tools/specs")?;
let multipag = catalogo.layout("multipag").expect("layout do ciclo");

let linhas = separar_linhas(&std::fs::read_to_string("remessa.txt")?);
let relatorio = aplicar_spec(&multipag.regras, &linhas);

for achado in &relatorio.achados {
    println!("linha {}: {}", achado.linha, achado.mensagem);
}
```

## Nada é aprovado por omissão

Condição `custom`, condição que depende de algo que o spec não carrega e guarda
que o avaliador não reconhece viram **não avaliadas**, com contagem e motivo.
Nunca `false`. Regra silenciosamente ignorada cria falsa confiança, que é pior
que a ausência do gate.

## A coerção do JavaScript é reproduzida, não corrigida

O validador do banco compara o resultado de `substring()` — sempre texto — ora
com literal entre aspas, ora com literal numérico, e no segundo caso o JavaScript
converte antes de comparar. É por isso que um campo em branco passa como zero e
`" 1"` passa como `01`. O campo `comparacao` de cada regra diz qual é o caso, e
`src/valor.rs` implementa as duas.

Pelo mesmo motivo `&&` e `||` curto-circuitam em `src/expressao.rs`: a guarda
identifica o registro antes de comparar o dígito, e avaliar o lado que o fonte
nunca olha faria a regra ser recusada em toda linha do arquivo.

## Paridade

`tests/paridade.rs` mede este motor contra o runner em TypeScript sobre o mesmo
corpus — achado a achado, recusa a recusa. O runner, por sua vez, foi medido
contra o validador oficial (`bun run golden`).

Os relatórios ficam congelados em `tools/paridade/`, gerados por
`bun run paridade`. Ler de arquivo faz o teste rodar sem toolchain de JavaScript
e faz qualquer mudança de comportamento aparecer no diff do PR. Do lado Bun,
`tests/paridade.test.ts` falha se o congelado sair de sincronia com o runner.
