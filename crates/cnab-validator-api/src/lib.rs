//! API HTTP de validação de arquivo CNAB.
//!
//! O motor (`cnab-core`) responde "o que este spec acusa neste arquivo". Esta
//! camada responde a pergunta que um emissor faz: **"o banco aceitaria este
//! arquivo?"** — e a diferença entre as duas é o que vive aqui:
//!
//! - **encoding**, porque CNAB é posicional em bytes ([`arquivo::decodificar`]);
//! - **delimitador de linha**, que o validador oficial checa fora das funções de
//!   layout e que portanto nenhum spec carrega ([`arquivo::conferir_delimitador`]);
//! - **envelope**, o comprimento das linhas contra o que o layout declara;
//! - o **veredito**, que junta tudo — e que só é `true` quando nada disso falha.
//!
//! O que esta camada **não** faz é decidir o layout por conta própria. Vários
//! layouts têm registros de 240 posições, e escolher errado valida o arquivo
//! contra o spec de outro produto: o resultado tem a cara de um relatório e não
//! significa nada. Quem chama informa, e `GET /layouts` lista o que existe.

pub mod arquivo;

use std::sync::Arc;

use axum::Router;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use cnab_core::{Achado, NaoAvaliada, aplicar_spec, separar_linhas};
use cnab_specs::Catalogo;
use serde::{Deserialize, Serialize};

use crate::arquivo::{Conformidade, LinhaForaDoTamanho};

#[derive(Clone)]
pub struct Estado {
    pub catalogo: Arc<Catalogo>,
}

pub fn rotas(catalogo: Arc<Catalogo>) -> Router {
    Router::new()
        .route("/saude", get(saude))
        .route("/layouts", get(layouts))
        .route("/validar", post(validar))
        .with_state(Estado { catalogo })
}

#[derive(Debug, Serialize)]
struct Saude {
    status: &'static str,
    fonte: String,
    total_regras: usize,
    layouts: usize,
}

async fn saude(State(estado): State<Estado>) -> impl IntoResponse {
    axum::Json(Saude {
        status: "ok",
        fonte: estado.catalogo.indice.fonte.clone(),
        total_regras: estado.catalogo.total_regras(),
        layouts: estado.catalogo.indice.layouts.len(),
    })
}

#[derive(Debug, Serialize)]
struct LayoutDisponivel {
    layout: String,
    tamanhos_linha: Vec<usize>,
    total_regras: usize,
    total_campos: usize,
    /// `false` quando o layout é catálogo de retorno: ele decodifica, não valida.
    valida_remessa: bool,
}

async fn layouts(State(estado): State<Estado>) -> impl IntoResponse {
    let lista: Vec<_> = estado
        .catalogo
        .indice
        .layouts
        .iter()
        .map(|l| LayoutDisponivel {
            layout: l.layout.clone(),
            tamanhos_linha: l.tamanhos_linha.clone(),
            total_regras: l.total_regras,
            total_campos: l.total_campos,
            valida_remessa: l.total_regras > 0,
        })
        .collect();
    axum::Json(lista)
}

#[derive(Debug, Deserialize)]
struct ParametrosValidacao {
    layout: String,
}

/// O veredito e tudo que o sustenta.
///
/// `conforme` é a única resposta de uma palavra, e ela é conservadora: exige
/// nenhum achado **e** delimitador certo **e** envelope certo. As não avaliadas
/// não a derrubam — seriam ruído, já que sempre há algumas —, mas viajam junto
/// com a contagem, porque um `conforme: true` com 200 regras não avaliadas
/// significa outra coisa que um com 9.
#[derive(Debug, Serialize)]
struct Veredito {
    layout: String,
    conforme: bool,
    linhas: usize,
    delimitador: Conformidade,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    linhas_fora_do_tamanho: Vec<LinhaForaDoTamanho>,
    achados: Vec<Achado>,
    regras_avaliadas: usize,
    total_regras: usize,
    nao_avaliadas: Vec<NaoAvaliada>,
}

async fn validar(
    State(estado): State<Estado>,
    Query(parametros): Query<ParametrosValidacao>,
    corpo: axum::body::Bytes,
) -> Result<Response, Erro> {
    let layout = estado
        .catalogo
        .layout(&parametros.layout)
        .ok_or_else(|| Erro::layout_desconhecido(&parametros.layout, &estado))?;

    if layout.regras.is_empty() {
        return Err(Erro::nao_valida_remessa(&parametros.layout));
    }
    if corpo.is_empty() {
        return Err(Erro::corpo_vazio());
    }

    let texto = arquivo::decodificar(&corpo);
    let delimitador = arquivo::conferir_delimitador(&texto);
    let linhas = separar_linhas(&texto);

    let entrada = estado
        .catalogo
        .indice
        .layouts
        .iter()
        .find(|l| l.layout == parametros.layout);
    let tamanhos = entrada
        .map(|l| l.tamanhos_linha.clone())
        .unwrap_or_default();
    let fora_do_tamanho = arquivo::linhas_fora_do_tamanho(&linhas, &tamanhos);

    let relatorio = aplicar_spec(&layout.regras, &linhas);

    let veredito = Veredito {
        layout: parametros.layout,
        conforme: relatorio.achados.is_empty()
            && delimitador.conforme
            && fora_do_tamanho.is_empty(),
        linhas: relatorio.linhas,
        delimitador,
        linhas_fora_do_tamanho: fora_do_tamanho,
        achados: relatorio.achados,
        regras_avaliadas: relatorio.regras_avaliadas,
        total_regras: relatorio.total_regras,
        nao_avaliadas: relatorio.nao_avaliadas,
    };

    Ok(axum::Json(veredito).into_response())
}

/// Erro de uso da API, sempre com o que fazer a seguir.
#[derive(Debug, Serialize)]
pub struct Erro {
    #[serde(skip)]
    status: StatusCode,
    erro: String,
    detalhe: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    layouts_disponiveis: Option<Vec<String>>,
}

impl Erro {
    fn layout_desconhecido(pedido: &str, estado: &Estado) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            erro: "layout_desconhecido".into(),
            detalhe: format!(
                "Não existe layout '{pedido}' no catálogo. O layout não é adivinhado: \
                 vários produtos usam registro de 240 posições, e validar contra o spec \
                 errado produz um relatório que não significa nada."
            ),
            layouts_disponiveis: Some(
                estado
                    .catalogo
                    .indice
                    .layouts
                    .iter()
                    .map(|l| l.layout.clone())
                    .collect(),
            ),
        }
    }

    fn nao_valida_remessa(pedido: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            erro: "layout_nao_valida_remessa".into(),
            detalhe: format!(
                "O layout '{pedido}' é catálogo de retorno: ele decodifica códigos de \
                 ocorrência, não carrega regra de validação. Não há o que validar aqui."
            ),
            layouts_disponiveis: None,
        }
    }

    fn corpo_vazio() -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            erro: "corpo_vazio".into(),
            detalhe: "Envie o conteúdo do arquivo CNAB no corpo da requisição.".into(),
            layouts_disponiveis: None,
        }
    }
}

impl IntoResponse for Erro {
    fn into_response(self) -> Response {
        (self.status, axum::Json(self)).into_response()
    }
}
