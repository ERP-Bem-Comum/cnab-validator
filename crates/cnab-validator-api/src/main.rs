//! Sobe a API.
//!
//! Os specs são carregados **de disco**, não embutidos no binário: são 3,5 MB que
//! mudam toda vez que o extrator roda, e poder trocá-los sem recompilar é o que
//! permite conferir uma extração nova contra um arquivo real na hora.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use cnab_specs::Catalogo;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let dir = diretorio_de_specs();
    let catalogo = Catalogo::carregar(&dir).map_err(|erro| {
        format!(
            "não foi possível carregar os specs de {}: {erro}\n\
             Aponte outro diretório com CNAB_SPECS=/caminho/para/tools/specs",
            dir.display()
        )
    })?;

    tracing::info!(
        specs = %dir.display(),
        layouts = catalogo.indice.layouts.len(),
        regras = catalogo.total_regras(),
        "specs carregados"
    );

    let endereco: SocketAddr = std::env::var("CNAB_ENDERECO")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse()?;

    let app = cnab_validator_api::rotas(Arc::new(catalogo))
        // Arquivo CNAB grande é da ordem de megabytes; o limite existe para o
        // corpo não ser um jeito de derrubar o processo.
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            32 * 1024 * 1024,
        ))
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let ouvinte = tokio::net::TcpListener::bind(endereco).await?;
    tracing::info!(%endereco, "API no ar");
    axum::serve(ouvinte, app)
        .with_graceful_shutdown(encerrar())
        .await?;
    Ok(())
}

/// `CNAB_SPECS`, ou `tools/specs` a partir da raiz do repositório.
fn diretorio_de_specs() -> PathBuf {
    if let Ok(caminho) = std::env::var("CNAB_SPECS") {
        return PathBuf::from(caminho);
    }
    // `CARGO_MANIFEST_DIR` é `crates/cnab-validator-api`; a raiz está dois acima.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join("tools/specs")
}

async fn encerrar() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("encerrando");
}
