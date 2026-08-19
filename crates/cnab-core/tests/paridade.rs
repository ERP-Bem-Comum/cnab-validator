//! Paridade com o runner em TypeScript sobre o mesmo corpus.
//!
//! O runner existe desde a Fase 0 e foi medido contra o validador oficial
//! (`bun run golden`): 0 falsos positivos, e as lacunas que restam têm causa
//! escrita. Ele é, portanto, o oráculo mais confiável que este repositório tem
//! enquanto o motor Rust não for medido diretamente.
//!
//! Os relatórios em `tools/paridade/` são congelados por `bun run paridade`. Ler
//! de arquivo em vez de rodar Bun aqui tem duas vantagens: o teste roda em CI sem
//! toolchain de JavaScript, e qualquer mudança de comportamento do runner aparece
//! no diff do PR, com nome e sobrenome, em vez de virar discussão sobre qual dos
//! dois lados está certo.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use cnab_core::{Achado, MotivoNaoAvaliada, aplicar_spec, separar_linhas};
use cnab_specs::Catalogo;
use serde::Deserialize;

const LAYOUT: &str = "multipag";

#[derive(Debug, Deserialize)]
struct RelatorioEsperado {
    arquivo: String,
    achados: Vec<Achado>,
    nao_avaliadas: Vec<NaoAvaliadaEsperada>,
    regras_avaliadas: usize,
    total_regras: usize,
    linhas: usize,
}

#[derive(Debug, Deserialize)]
struct NaoAvaliadaEsperada {
    regra_id: String,
    motivo: MotivoNaoAvaliada,
    ocorrencias: usize,
    #[allow(dead_code)]
    detalhe: Option<String>,
}

fn raiz() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn esperados() -> Vec<RelatorioEsperado> {
    let dir = raiz().join("tools/paridade").join(LAYOUT);
    let mut arquivos: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|erro| panic!("{}: {erro}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    arquivos.sort();
    assert!(
        !arquivos.is_empty(),
        "sem relatórios de paridade; rode `bun run paridade`"
    );

    arquivos
        .iter()
        .map(|caminho| {
            let conteudo = std::fs::read_to_string(caminho).expect("relatório legível");
            serde_json::from_str(&conteudo)
                .unwrap_or_else(|erro| panic!("{}: {erro}", caminho.display()))
        })
        .collect()
}

fn linhas_do_corpus(arquivo: &str) -> Vec<String> {
    let caminho: PathBuf = raiz()
        .join("tools/spec-extractor/tests/fixtures/corpus")
        .join(arquivo);
    separar_linhas(&ler(&caminho))
}

fn ler(caminho: &Path) -> String {
    std::fs::read_to_string(caminho).unwrap_or_else(|erro| panic!("{}: {erro}", caminho.display()))
}

#[test]
fn os_dois_motores_acusam_os_mesmos_achados() {
    let catalogo = Catalogo::carregar(raiz().join("tools/specs")).expect("specs versionados");
    let layout = catalogo.layout(LAYOUT).expect("layout do ciclo");

    for esperado in esperados() {
        let linhas = linhas_do_corpus(&esperado.arquivo);
        let obtido = aplicar_spec(&layout.regras, &linhas);

        assert_eq!(
            obtido.linhas, esperado.linhas,
            "{}: contagem de linhas",
            esperado.arquivo
        );
        assert_eq!(
            obtido.total_regras, esperado.total_regras,
            "{}: total de regras",
            esperado.arquivo
        );

        // Achado a achado, na ordem: regra, linha, registro, colunas e mensagem
        // já preenchida. Divergir em qualquer um deles é divergir do validador.
        assert_eq!(
            obtido.achados, esperado.achados,
            "{}: achados divergem do runner",
            esperado.arquivo
        );
    }
}

#[test]
fn os_dois_motores_recusam_as_mesmas_regras_pelo_mesmo_motivo() {
    let catalogo = Catalogo::carregar(raiz().join("tools/specs")).expect("specs versionados");
    let layout = catalogo.layout(LAYOUT).expect("layout do ciclo");

    for esperado in esperados() {
        let linhas = linhas_do_corpus(&esperado.arquivo);
        let obtido = aplicar_spec(&layout.regras, &linhas);

        // O texto do `detalhe` fica de fora: é diagnóstico para quem lê o
        // relatório, e prendê-lo aqui travaria a redação da mensagem nos dois
        // lados. O par (regra, motivo) é o que precisa concordar.
        let nossas: BTreeSet<(String, MotivoNaoAvaliada)> = obtido
            .nao_avaliadas
            .iter()
            .map(|n| (n.regra_id.clone(), n.motivo))
            .collect();
        let deles: BTreeSet<(String, MotivoNaoAvaliada)> = esperado
            .nao_avaliadas
            .iter()
            .map(|n| (n.regra_id.clone(), n.motivo))
            .collect();

        let so_no_rust: Vec<_> = nossas.difference(&deles).collect();
        let so_no_runner: Vec<_> = deles.difference(&nossas).collect();
        assert!(
            so_no_rust.is_empty() && so_no_runner.is_empty(),
            "{}: recusas divergem — só no cnab-core: {so_no_rust:?}; só no runner: {so_no_runner:?}",
            esperado.arquivo
        );

        for esperada in &esperado.nao_avaliadas {
            let nossa = obtido
                .nao_avaliadas
                .iter()
                .find(|n| n.regra_id == esperada.regra_id && n.motivo == esperada.motivo)
                .expect("presente pela comparação de conjunto acima");
            assert_eq!(
                nossa.ocorrencias, esperada.ocorrencias,
                "{}: {} recusada em número diferente de linhas",
                esperado.arquivo, esperada.regra_id
            );
        }

        assert_eq!(
            obtido.regras_avaliadas, esperado.regras_avaliadas,
            "{}: quantidade de regras efetivamente avaliadas",
            esperado.arquivo
        );
    }
}

#[test]
fn o_defeito_conhecido_do_corpus_e_reprovado_pelo_motor() {
    // Não é redundante com a paridade: fixa o que o gate precisa pegar, para que
    // uma regressão apareça como "o motor parou de pegar a câmara", e não como
    // uma diferença numérica contra um arquivo de referência.
    let catalogo = Catalogo::carregar(raiz().join("tools/specs")).expect("specs versionados");
    let layout = catalogo.layout(LAYOUT).expect("layout do ciclo");

    let linhas = linhas_do_corpus("multipag-camara-invalida.txt");
    let relatorio = aplicar_spec(&layout.regras, &linhas);

    let camara: Vec<&Achado> = relatorio
        .achados
        .iter()
        .filter(|a| a.mensagem.contains("Informado 018-TED"))
        .collect();

    assert_eq!(camara.len(), 1, "esperava exatamente um achado da câmara");
    assert_eq!(camara[0].registro, "segmento-a");
    assert_eq!(camara[0].linha, 3);
    // A regra lê a câmara (018-020) e o banco do favorecido (021-023): a faixa
    // publicada envolve as duas.
    assert_eq!(camara[0].colunas, [18, 23]);
}

#[test]
fn arquivo_correto_nao_produz_achado() {
    let catalogo = Catalogo::carregar(raiz().join("tools/specs")).expect("specs versionados");
    let layout = catalogo.layout(LAYOUT).expect("layout do ciclo");

    let linhas = linhas_do_corpus("multipag-correto.txt");
    let relatorio = aplicar_spec(&layout.regras, &linhas);

    assert_eq!(
        relatorio.achados,
        Vec::new(),
        "arquivo conforme não pode produzir achado"
    );
    assert!(
        relatorio.regras_avaliadas > 0,
        "aprovar sem avaliar nada não é aprovar"
    );
}
