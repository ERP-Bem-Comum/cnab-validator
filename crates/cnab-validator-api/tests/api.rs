//! A API sobre o mesmo corpus que o motor e o runner usam.
//!
//! O que se testa aqui é o que **só existe nesta camada** — delimitador,
//! encoding, envelope e o veredito que junta os três. A concordância com o
//! validador oficial é assunto do golden e da paridade; repetir aquilo aqui
//! duplicaria o oráculo sem acrescentar cobertura.

use std::path::PathBuf;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use cnab_specs::Catalogo;
use serde_json::Value;
use tower::ServiceExt;

fn raiz() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn catalogo() -> Arc<Catalogo> {
    Arc::new(Catalogo::carregar(raiz().join("tools/specs")).expect("specs versionados"))
}

fn corpus(arquivo: &str) -> Vec<u8> {
    std::fs::read(
        raiz()
            .join("tools/spec-extractor/tests/fixtures/corpus")
            .join(arquivo),
    )
    .unwrap_or_else(|e| panic!("corpus {arquivo}: {e}"))
}

async fn post(caminho: &str, corpo: Vec<u8>) -> (StatusCode, Value) {
    let app = cnab_validator_api::rotas(catalogo());
    let resposta = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(caminho)
                .body(Body::from(corpo))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resposta.status();
    let bytes = axum::body::to_bytes(resposta.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn get(caminho: &str) -> (StatusCode, Value) {
    let app = cnab_validator_api::rotas(catalogo());
    let resposta = app
        .oneshot(Request::builder().uri(caminho).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resposta.status();
    let bytes = axum::body::to_bytes(resposta.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn arquivo_conforme_e_aprovado_com_o_placar_a_vista() {
    let (status, corpo) = post("/validar?layout=multipag", corpus("multipag-correto.txt")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(corpo["conforme"], true);
    assert_eq!(corpo["achados"].as_array().unwrap().len(), 0);
    // O placar viaja junto: `conforme` com 200 regras não avaliadas significaria
    // outra coisa que `conforme` com 9.
    assert!(corpo["regras_avaliadas"].as_u64().unwrap() > 0);
    assert!(corpo["total_regras"].as_u64().unwrap() > 0);
}

#[tokio::test]
async fn defeito_no_arquivo_derruba_o_veredito_e_aponta_a_coluna() {
    let (_, corpo) = post(
        "/validar?layout=multipag",
        corpus("multipag-camara-invalida.txt"),
    )
    .await;
    assert_eq!(corpo["conforme"], false);
    let achados = corpo["achados"].as_array().unwrap();
    assert!(!achados.is_empty());
    assert_eq!(achados[0]["linha"], 3);
    assert_eq!(achados[0]["registro"], "segmento-a");
}

#[tokio::test]
async fn arquivo_sem_crlf_e_recusado_mesmo_sem_nenhum_achado() {
    // O buraco que esta camada existe para tapar. O conteúdo é o do arquivo
    // correto; só o delimitador muda. O motor não tem o que acusar — a checagem
    // do banco vive fora das funções de layout, e nenhum spec a carrega —, mas o
    // arquivo seria recusado linha a linha do outro lado.
    let com_lf: Vec<u8> = String::from_utf8(corpus("multipag-correto.txt"))
        .unwrap()
        .replace("\r\n", "\n")
        .into_bytes();

    let (_, corpo) = post("/validar?layout=multipag", com_lf).await;
    assert_eq!(corpo["achados"].as_array().unwrap().len(), 0);
    assert_eq!(corpo["conforme"], false, "LF não pode passar como conforme");
    assert_eq!(corpo["delimitador"]["encontrado"], "lf");
    assert!(corpo["delimitador"]["observacao"].is_string());
}

#[tokio::test]
async fn linha_fora_do_tamanho_do_layout_derruba_o_veredito() {
    let (_, corpo) = post("/validar?layout=multipag", corpus("multipag-truncado.txt")).await;
    assert_eq!(corpo["conforme"], false);
    let fora = corpo["linhas_fora_do_tamanho"].as_array().unwrap();
    assert!(!fora.is_empty(), "a linha cortada tem de aparecer");
}

#[tokio::test]
async fn layout_nao_e_adivinhado() {
    let (status, corpo) = post("/validar?layout=pix", corpus("multipag-correto.txt")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(corpo["erro"], "layout_desconhecido");
    // O erro precisa dizer o que existe, senão quem chama fica adivinhando.
    assert!(corpo["layouts_disponiveis"].as_array().unwrap().len() >= 3);
}

#[tokio::test]
async fn catalogo_de_retorno_nao_finge_validar() {
    let (status, corpo) = post(
        "/validar?layout=retorno-multipag",
        corpus("multipag-correto.txt"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(corpo["erro"], "layout_nao_valida_remessa");
}

#[tokio::test]
async fn corpo_vazio_e_erro_de_uso_e_nao_arquivo_conforme() {
    let (status, corpo) = post("/validar?layout=multipag", Vec::new()).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(corpo["erro"], "corpo_vazio");
}

#[tokio::test]
async fn acento_latin1_nao_desloca_as_colunas() {
    // Um nome de favorecido com acento em latin-1 ocupa um byte. Decodificar como
    // UTF-8 juntaria dois e andaria uma coluna em tudo que vem depois — o achado
    // sairia na coluna errada, ou sumiria.
    let mut bytes = corpus("multipag-camara-invalida.txt");
    // Posição 43-73 do Segmento A (linha 3) é o nome do favorecido.
    let inicio_linha3 = bytes
        .windows(2)
        .enumerate()
        .filter(|(_, w)| w == b"\r\n")
        .nth(1)
        .map(|(i, _)| i + 2)
        .expect("três linhas ao menos");
    bytes[inicio_linha3 + 43] = 0xC7; // 'Ç' em latin-1

    let (_, corpo) = post("/validar?layout=multipag", bytes).await;
    let achados = corpo["achados"].as_array().unwrap();
    // O defeito injetado no arquivo original continua sendo acusado na mesma
    // coluna: o acento não moveu nada.
    assert!(
        achados
            .iter()
            .any(|a| a["linha"] == 3 && a["colunas"][0] == 18),
        "o achado da câmara tem de sobreviver ao acento"
    );
}

#[tokio::test]
async fn layouts_lista_o_que_existe_e_diz_o_que_valida() {
    let (status, corpo) = get("/layouts").await;
    assert_eq!(status, StatusCode::OK);
    let lista = corpo.as_array().unwrap();
    let multipag = lista.iter().find(|l| l["layout"] == "multipag").unwrap();
    assert_eq!(multipag["valida_remessa"], true);
    let retorno = lista
        .iter()
        .find(|l| l["layout"] == "retorno-multipag")
        .unwrap();
    assert_eq!(retorno["valida_remessa"], false);
}

#[tokio::test]
async fn saude_responde_de_qual_extracao_a_api_esta_servindo() {
    let (status, corpo) = get("/saude").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(corpo["status"], "ok");
    // Sem isto não há como saber se a API está com o spec de ontem ou o de hoje.
    assert!(corpo["fonte"].as_str().unwrap().contains("bradesco"));
    assert!(corpo["total_regras"].as_u64().unwrap() > 1000);
}

async fn post_json(caminho: &str, corpo: serde_json::Value) -> (StatusCode, Value) {
    let app = cnab_validator_api::rotas(catalogo());
    let resposta = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(caminho)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&corpo).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resposta.status();
    let bytes = axum::body::to_bytes(resposta.into_body(), usize::MAX)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned())),
    )
}

fn remessa_texto() -> String {
    corpus("multipag-correto.txt")
        .iter()
        .map(|b| *b as char)
        .collect()
}

#[tokio::test]
async fn gera_retorno_com_ocorrencia_no_detalhe_e_no_envelope() {
    let (status, corpo) = post_json(
        "/retorno?detalhado=true",
        serde_json::json!({
            "remessa": remessa_texto(),
            "cenario": { "padrao": ["00"], "envelope": ["01"] }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let escritas = corpo["escritas"].as_array().unwrap();
    // O envelope é o caso que um consumidor que varre só o detalhe não enxerga —
    // simular isso é metade da razão de o gerador existir.
    assert!(escritas.iter().any(|e| e["registro"] == "header-arquivo"));
    assert!(escritas.iter().any(|e| e["registro"] == "detalhe"));

    let conteudo = corpo["conteudo"].as_str().unwrap();
    assert!(conteudo.ends_with("\r\n"), "o retorno sai com CRLF");
    // Coluna 143 do header de arquivo deixa de dizer "remessa": sem isso o
    // próprio banco lê o arquivo como remessa devolvida por engano.
    assert_eq!(conteudo.chars().nth(142), Some('2'));
}

#[tokio::test]
async fn cenario_com_codigo_fora_do_catalogo_e_recusado() {
    let (status, corpo) = post_json(
        "/retorno",
        serde_json::json!({
            "remessa": remessa_texto(),
            "cenario": { "padrao": ["ZZ"] }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(corpo["erro"], "cenario_invalido");
    assert!(corpo["detalhe"].as_str().unwrap().contains("ZZ"));
}

#[tokio::test]
async fn sem_detalhado_a_resposta_e_o_arquivo_cru() {
    let (status, corpo) = post_json(
        "/retorno",
        serde_json::json!({
            "remessa": remessa_texto(),
            "cenario": { "padrao": ["00"] }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Sem `detalhado` vem o arquivo, não JSON — é o que se grava em disco.
    let texto = corpo.as_str().expect("arquivo cru");
    assert!(texto.ends_with("\r\n"));
}
