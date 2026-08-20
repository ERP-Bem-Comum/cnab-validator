# Design: Validador de Arquivos Bradesco (CNAB 240 + Multipag)

**Data:** 2026-08-18  
**Linguagem:** Rust (edition 2024, rust-version 1.85)  
**Abordagem:** Reimplementação nativa a partir de specs JSON extraídos do validador oficial  
**Escopo do primeiro ciclo:** Cobrança Remessa 240, Multipag 240, Folha de Pagamento 240  
**Formato:** API HTTP (Axum) + CLI (clap)  

---

## 1. Contexto

O validador oficial do Bradesco é 100% client-side. Não existe API do banco para consumir. A análise técnica original propôs embrulhar o JavaScript original em Node.js, mas este projeto opta por **reimplementação nativa em Rust** a partir das regras extraídas automaticamente dos assets públicos do validador.

Essa escolha elimina a dependência de um runtime JavaScript, aumenta a performance para arquivos grandes e produz um serviço mais fácil de empacotar e operar.

---

## 2. Objetivo

Entregar um validador de arquivos CNAB do Bradesco que:

1. Detecte automaticamente o layout (Cobrança 240, Multipag 240, Folha 240 neste ciclo).
2. Aplique as regras estruturais do validador oficial e reporte erros em JSON tipado.
3. Ofereça API HTTP para integração e CLI para uso local.
4. Processe arquivos grandes sem o limite de 10 mil linhas do navegador.
5. Preserve privacidade: sem persistência de conteúdo, logs sem dados pessoais.

---

## 3. Decisões de design

| Decisão | Opção escolhida | Justificativa |
|---------|-----------------|---------------|
| Linguagem | Rust | Performance, segurança de memória, binário único, alinhado com a preferência do usuário. |
| Abordagem | Motor declarativo a partir de specs JSON | Manutenibilidade e testabilidade superiores ao wrapper JS. |
| Escopo inicial | Cobrança 240, Multipag 240, Folha 240 | Cobre os layouts CNAB 240 mais relevantes; outros layouts em ciclos futuros. |
| Formato | API HTTP + CLI | API para integração, CLI para desenvolvimento e automação. |
| HTTP framework | Axum | Moderno, baseado em Tower, boa integração com tracing e async. |
| Extração de specs | Bun temporário em `tools/spec-extractor/` | Os assets do Bradesco são JS; AST é mais fácil de fazer em Bun/TypeScript. O extrator roda fora do runtime principal. |

---

## 4. Arquitetura

```
cnab-validator/
├── tools/
│   └── spec-extractor/        # Node.js: download + AST + geração dos specs
├── specs/
│   ├── index.json             # catálogo de layouts
│   └── layouts/
│       ├── cobranca-remessa.json
│       ├── multipag.json
│       └── folha-pagamento.json
└── crates/
    ├── cnab-core/             # motor declarativo, parsing, detecção de layout
    ├── cnab-specs/            # structs geradas/derivadas dos specs JSON
    ├── cnab-validator-cli/    # CLI
    └── cnab-validator-api/    # API HTTP (Axum)
```

### Separação de responsabilidades

- `cnab-core`: contém o motor de regras, parser de arquivo e detecção de layout. Não depende de I/O nem de frameworks web.
- `cnab-specs`: representação dos specs JSON em structs Rust; responsável por carregar e expor as regras para `cnab-core`.
- `cnab-validator-cli`: aplicação de linha de comando que consome `cnab-core`.
- `cnab-validator-api`: aplicação HTTP que consome `cnab-core`.

---

## 5. Extração dos specs

O extrator em Bun/TypeScript realiza:

1. Download do HTML do validador (`https://wspf.banco.bradesco/wsValidadorUniversal/validadorgeral`) e dos arquivos `.js` referenciados.
2. Extração de funções inline do HTML (ex: `obterValorCNPJAlfanumerico`).
3. Parse com `acorn` e identificação de `IfStatement` que concatenam mensagens de erro.
4. Geração de `specs/index.json` e `specs/layouts/<layout>.json` no formato já definido pela análise técnica.

Para este ciclo, o extrator deve gerar specs apenas para os layouts selecionados. Layouts adicionais podem ser adicionados depois sem mudar a arquitetura.

**FEBRABAN vs Bradesco:** o extrator deve capturar literalmente as strings e offsets programados no validador oficial do Bradesco, não generalizar a partir do manual FEBRABAN genérico. O banco pode impor regras institucionais em campos marcados como "Uso Exclusivo FEBRABAN/CNAB", e a fonte da verdade é o código do front-end.

### Monitor de mudança

O extrator calcula hash SHA-256 dos assets baixados e os compara com um baseline versionado. Quando há mudança, emite alerta para re-extrair e revalidar o corpus de testes.

---

## 6. Modelo de dados e DSL

### Arquivo parseado

Para suportar arquivos grandes sem carregar todo o conteúdo na heap, o arquivo é representado como um *backing* de bytes com um índice de offsets por linha.

```rust
pub struct ArquivoCnab {
    pub nome: String,
    pub backing: Backing,
    pub offsets: Vec<usize>,     // posição de início de cada linha no backing
    pub metadados: Metadados,
}

pub enum Backing {
    Owned(Vec<u8>),               // arquivos pequenos (uploads em memória)
    Mmap(memmap2::Mmap),          // arquivos grandes (uploads flushados em disco)
}

pub struct Metadados {
    pub encoding: Encoding,
    pub delimitador: Delimitador,
    pub tamanho_linha: usize,    // tamanho esperado do layout detectado
    pub total_linhas: usize,
}
```

A função `linha(i)` retorna uma fatia `&[u8]` sem alocação. O delimitador (CRLF ou LF) é excluído da fatia no momento da construção do índice de offsets, garantindo que as regras operem apenas sobre os 240 bytes úteis do registro.

### Regra

```rust
pub struct Regra {
    pub id: String,
    pub funcao_origem: String,   // função JS de origem (ex: validarDadosArquivo240)
    pub registro: Registro,
    pub alvo: Alvo,
    pub condicao: Condicao,
    pub mensagem: String,
    pub severidade: Severidade,
}

pub enum Condicao {
    LiteralFixo {
        posicao: Posicao,
        esperado: String,
        operador: Operador,
    },
    NumericoBranco {
        posicao: Posicao,
    },
    Dominio {
        posicao: Posicao,
        valores: HashSet<String>,
    },
    DigitoVerificador {
        posicao: Posicao,
        documento: Documento,
    },
    CoerenciaRegistro {
        atual: Alvo,
        outro: Alvo,
        condicao: Box<Condicao>,
    },
}
```

### Posição

```rust
pub struct Posicao {
    pub inicio0: usize,   // offset 0-based, exclusivo no fim
    pub fim0: usize,
    pub coluna_inicio: usize, // 1-based, para mensagens
    pub coluna_fim: usize,
}
```

### Resultado

```rust
pub struct Achado {
    pub linha: usize,
    pub registro: Registro,
    pub coluna_inicio: usize,
    pub coluna_fim: usize,
    pub mensagem: String,
    pub severidade: Severidade,
    pub regra_id: String,
    pub valor_encontrado: Option<String>,
}

pub struct ValidationReport {
    pub valido: bool,
    pub layout_detectado: LayoutDetectado,
    pub arquivo: ArquivoInfo,
    pub resumo: Resumo,
    pub achados: Vec<Achado>,
}
```

### Escape hatch

Regras que não se encaixam na DSL são implementadas como funções Rust manuais e registradas no motor via uma variante `Condicao::Custom(Box<dyn Fn(&ArquivoCnab, usize) -> Option<Achado>>)`. Isso garante fidelidade sem poluir a DSL.

---

## 7. Fluxo de validação

```text
bytes do arquivo
   └─ detecta encoding (ISO-8859-1 ↔ UTF-8)
   └─ split em linhas (CRLF, com fallback para LF)
   └─ remove linhas vazias
   └─ detecta layout por assinatura posicional
   └─ carrega regras do layout
   └─ motor aplica cada regra
   └─ retorna ValidationReport
```

### Detecção de layout

Reimplementa o roteamento do `verificadorGeral.js` como uma lista ordenada de detectores. A ordem é importante porque as condições se sobrepõem.

### Robustez

Acesso fora dos limites do array (`res[i+1]` em arquivos truncados) retorna string vazia em vez de panicar. O motor isola falhas por regra: uma regra que panicar não aborta a validação inteira.

### Encoding e comparação de bytes

As regras comparam vetores de bytes na estrutura nativa do arquivo (`&[u8]`). Literais esperados são armazenados como `Vec<u8>` no encoding detectado (ISO-8859-1 ou UTF-8). A decodificação para `String` só ocorre quando necessário para mensagens de erro ou logs, e nunca para o caminho crítico de validação.

### Arquivos temporários e LGPD

Uploads grandes são flushados para arquivo temporário via `tempfile`, garantindo remoção automática do filesystem quando o handle for fechado, mesmo em caso de falha abrupta.

### Diferenças propositais em relação ao validador original

| Item | Original | Este validador |
|------|----------|----------------|
| Limite de linhas | 10.000 (do navegador) | Configurável; limitado pela memória disponível |
| Extensão do arquivo | Validada contra lista fixa | Ignorada; valida conteúdo |
| Saída | HTML com `<br>` | JSON tipado (+ texto opcional) |
| Encoding | Detectado pelo browser | Detectado explicitamente |
| Índice fora do array | Aborta silenciosamente | Retorna string vazia |

---

## 8. API HTTP

### Framework

Axum, com `tokio`, `serde_json`, `tracing` e `tower`.

### Endpoints

- `POST /v1/validacoes` — valida arquivo via `multipart/form-data` (campo `arquivo`) ou JSON com `conteudo_base64`.
- `POST /v1/deteccoes` — só identifica o layout.
- `GET /v1/layouts` — catálogo de layouts suportados.
- `GET /health` — saúde do serviço.

### Request (JSON)

```json
{
  "nome_arquivo": "remessa_20260818.rem",
  "conteudo_base64": "MjM3MDAwMDA...",
  "layout": "auto",
  "encoding": "auto",
  "formato": "json"
}
```

### Response 200

```json
{
  "valido": false,
  "layout_detectado": {
    "layout": "cobranca-remessa",
    "variante": "240",
    "confianca": "alta"
  },
  "arquivo": {
    "nome": "remessa_20260818.rem",
    "linhas": 1284,
    "tamanho_linha": 240,
    "delimitador": "CRLF",
    "encoding": "ISO-8859-1"
  },
  "resumo": {
    "erros": 36,
    "por_registro": {
      "header-arquivo": 12,
      "segmento-p": 20,
      "trailer": 4
    }
  },
  "achados": [
    {
      "linha": 1,
      "registro": "Header de arquivo",
      "coluna_inicio": 4,
      "coluna_fim": 7,
      "mensagem": "não contém número de lote 0000.",
      "severidade": "erro",
      "regra_id": "cobranca-remessa:117",
      "valor_encontrado": "0001"
    }
  ]
}
```

### Erros

- `422`: arquivo ilegível ou layout não identificado.
- `413`: arquivo acima do teto configurado.
- `500`: erro interno não esperado.

### Observabilidade

- `tracing` para logs estruturados.
- Conteúdo de linhas nunca é logado.
- Métricas: total de requisições, taxa de erros, layouts detectados.

---

## 9. CLI

Usando `clap` com derive macros.

### Comandos

```bash
cnab-validator validate arquivo.rem --layout auto --encoding auto --output json
cnab-validator detect arquivo.rem
cnab-validator list-layouts
```

### Comportamento

- Saída JSON por padrão; `--output human` para texto legível.
- Erros para `stderr`, dados para `stdout`.
- Exit codes: `0` válido, `1` inválido, `2+` erro de execução.
- Encoding: `auto`, `iso-8859-1`, `utf-8`.

---

## 10. Testes

### Unitários (`cnab-core`)

- Cada variante de `Condicao` com strings sintéticas.
- Detecção de layout com amostras mínimas.
- Parsing de encoding e delimitadores.

### Golden tests

Corpus de arquivos por layout:

- 1 arquivo válido.
- 1 arquivo com erro por registro (header, detalhe, trailer, segmento).
- 1 arquivo truncado.
- 1 arquivo com LF puro.
- 1 arquivo com acentuação.
- 1 arquivo vazio.

### Integração

- CLI: executa o binário e verifica exit code + JSON.
- API: testa endpoints com `tower::ServiceExt` ou `reqwest`.

### Sincronização

Quando o extrator detecta mudança nos assets do Bradesco, o corpus é reexecutado e o diff das saídas é reportado.

---

## 11. LGPD e segurança

Arquivos CNAB podem conter CPF, CNPJ, nomes, contas bancárias e valores. Os controles mínimos são:

- Processamento em memória, sem persistência por padrão.
- TLS obrigatório na API.
- Logs sem conteúdo de linha: apenas posição, regra e severidade.
- Retenção zero por padrão.
- Se houver persistência para auditoria, cifragem em repouso e prazo definido.
- Registro da operação no ROPA, se aplicável.

---

## 12. Riscos e mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Bradesco muda os assets | Alto | Hash diário, alerta automático, corpus de regressão. |
| Regra não mapeável na DSL | Médio | Escape hatch para funções Rust manuais. |
| Fidelidade menor que wrapper JS | Médio | Golden tests contra o validador oficial (Playwright). |
| Código JS tem comportamento não documentado | Médio | Comparar saída com o oficial e revisar manualmente casos de borda. |
| Dados pessoais no tráfego | Alto | TLS, logs sanitizados, retenção zero. |

---

## 13. Fases de implementação

| Fase | Entrega | Esforço estimado |
|------|---------|------------------|
| 0 — Extrator de specs | Download dos assets, AST, geração dos JSONs dos 3 layouts | 1 dia |
| 1 — Núcleo Rust | `cnab-core`: parser, detecção, motor declarativo, regras básicas | 2 dias |
| 2 — Specs Rust | `cnab-specs`: structs + carregamento dos JSONs | 0,5 dia |
| 3 — Cobrança 240 | Regras completas + corpus de testes | 1,5 dia |
| 4 — Multipag 240 | Regras completas + corpus de testes | 1 dia |
| 5 — Folha 240 | Regras completas + corpus de testes | 1 dia |
| 6 — CLI | `cnab-validator-cli` | 0,5 dia |
| 7 — API HTTP | `cnab-validator-api` + OpenAPI | 1 dia |
| 8 — Golden tests | Playwright contra validador oficial + CI | 1 dia |
| 9 — Produção | Docker, rate limit, observabilidade, política de logs | 1 dia |
| **Total** | | **~10 dias** |

---

## 14. Referências

- Análise técnica original: validador 100% client-side, 13 arquivos JS, ~7.300 regras mapeadas.
- Manual CNAB 240 do Bradesco (fornecido pelo usuário) para conferência de posições.
- [BoletoNet](https://github.com/BoletoNet/boletonet): referência de estrutura CNAB 240 e cálculos de dígito verificador.
- [rust-skills](https://github.com/actionbook/rust-skills): diretrizes de codificação Rust adotadas.
