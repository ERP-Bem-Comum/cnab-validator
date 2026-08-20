//! O gerador sobre o catálogo versionado e o corpus real.

use std::collections::BTreeMap;
use std::path::PathBuf;

use cnab_retorno::{Cenario, ErroDeGeracao, campo_de_ocorrencias, gerar};
use cnab_specs::{Catalogo, Layout};

fn raiz() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn catalogo() -> Catalogo {
    Catalogo::carregar(raiz().join("tools/specs")).expect("specs versionados")
}

fn retorno(c: &Catalogo) -> &Layout {
    c.layout("retorno-multipag").expect("layout de retorno")
}

fn remessa() -> Vec<String> {
    let bytes = std::fs::read(
        raiz().join("tools/spec-extractor/tests/fixtures/corpus/multipag-correto.txt"),
    )
    .expect("corpus");
    cnab_core::separar_linhas(&bytes.iter().map(|b| *b as char).collect::<String>())
}

fn cenario(padrao: &[&str], envelope: &[&str]) -> Cenario {
    Cenario {
        padrao: padrao.iter().map(|s| s.to_string()).collect(),
        envelope: envelope.iter().map(|s| s.to_string()).collect(),
        por_linha: BTreeMap::new(),
        ..Cenario::default()
    }
}

#[test]
fn escreve_nas_fatias_que_o_catalogo_declara_e_nao_toca_no_resto() {
    let c = catalogo();
    let linhas = remessa();
    let g = gerar(retorno(&c), &linhas, &cenario(&["00"], &[])).expect("gera");

    let saida = cnab_core::separar_linhas(&g.conteudo);
    assert_eq!(saida.len(), linhas.len());

    // Linha 3 é o Segmento A. As colunas 231-232 recebem o código; tudo antes da
    // faixa continua idêntico — o retorno é a remessa devolvida, não um arquivo
    // novo.
    let antes: String = linhas[2].chars().take(230).collect();
    let depois: String = saida[2].chars().take(230).collect();
    assert_eq!(antes, depois, "o gerador não pode tocar fora da faixa");
    assert_eq!(saida[2].chars().nth(230), Some('0'));
    assert_eq!(saida[2].chars().nth(231), Some('0'));
}

#[test]
fn a_fatia_sem_codigo_fica_em_branco_e_nao_em_zero() {
    // `00` é um código que o banco decodifica — "Débito Efetivado". Preencher a
    // sobra com zero diria algo que o cenário não pediu.
    let c = catalogo();
    let g = gerar(retorno(&c), &remessa(), &cenario(&["01"], &[])).expect("gera");
    let saida = cnab_core::separar_linhas(&g.conteudo);
    let faixa: String = saida[2].chars().skip(230).take(10).collect();
    assert_eq!(faixa, "01        ");
}

#[test]
fn escreve_as_cinco_ocorrencias_que_o_campo_comporta() {
    // O campo carrega cinco códigos concatenados, e o que se perde ao tratá-lo
    // como um só costuma ser a causa secundária da recusa.
    let c = catalogo();
    let campo = campo_de_ocorrencias(retorno(&c)).unwrap();
    // Cinco códigos que o fonte reconhece nas cinco fatias — o catálogo diz
    // quais são, e escolher à mão daria num que ele decodifica só na primeira.
    let universais: Vec<String> = campo
        .entradas
        .iter()
        .filter(|e| e.slots.len() == campo.slots.len())
        .take(5)
        .map(|e| e.codigo.clone())
        .collect();
    assert_eq!(universais.len(), 5);

    let cen = Cenario {
        padrao: universais.clone(),
        envelope: Vec::new(),
        por_linha: BTreeMap::new(),
        ..Cenario::default()
    };
    let g = gerar(retorno(&c), &remessa(), &cen).expect("gera");
    let saida = cnab_core::separar_linhas(&g.conteudo);
    let faixa: String = saida[2].chars().skip(230).take(10).collect();
    assert_eq!(faixa, universais.concat());
}

#[test]
fn codigo_valido_so_na_primeira_fatia_e_recusado_nas_outras() {
    // `00` é "Débito Efetivado" — o código mais provável num cenário de sucesso —
    // e o fonte só o decodifica na fatia 1. Escrito na segunda, o banco o leria
    // como desconhecido, e o arquivo passaria por qualquer inspeção visual.
    let c = catalogo();
    let campo = campo_de_ocorrencias(retorno(&c)).unwrap();
    let so_na_primeira = campo
        .entradas
        .iter()
        .find(|e| e.slots == vec![1])
        .expect("o catálogo tem ao menos um código de fatia única");

    let cen = Cenario {
        padrao: vec!["01".into(), so_na_primeira.codigo.clone()],
        envelope: Vec::new(),
        por_linha: BTreeMap::new(),
        ..Cenario::default()
    };
    let erro = gerar(retorno(&c), &remessa(), &cen).unwrap_err();
    assert!(
        matches!(erro, ErroDeGeracao::CodigoForaDaFatia { ref codigo, fatia, .. }
            if codigo == &so_na_primeira.codigo && fatia == 2),
        "esperava recusa por fatia, veio {erro:?}"
    );

    // E na fatia em que ele vale, passa.
    let ok = Cenario {
        padrao: vec![so_na_primeira.codigo.clone()],
        envelope: Vec::new(),
        por_linha: BTreeMap::new(),
        ..Cenario::default()
    };
    assert!(gerar(retorno(&c), &remessa(), &ok).is_ok());
}

#[test]
fn o_envelope_recebe_ocorrencia_separada_do_detalhe() {
    // É o caso que um consumidor que varre só o detalhe não enxerga, e simular
    // isso é metade da razão de o gerador existir.
    let c = catalogo();
    let linhas = remessa();
    let g = gerar(retorno(&c), &linhas, &cenario(&[], &["01"])).expect("gera");
    let saida = cnab_core::separar_linhas(&g.conteudo);

    // Linha 1 é header de arquivo; linha 6, trailer de arquivo.
    assert_eq!(saida[0].chars().skip(230).take(2).collect::<String>(), "01");
    assert_eq!(saida[5].chars().skip(230).take(2).collect::<String>(), "01");
    // E o detalhe ficou intacto, porque o cenário não pediu nada para ele.
    assert_eq!(saida[2], linhas[2]);
}

#[test]
fn override_por_linha_vence_o_padrao() {
    let c = catalogo();
    let mut cen = cenario(&["00"], &[]);
    cen.por_linha.insert(4, vec!["01".into(), "02".into()]);
    let g = gerar(retorno(&c), &remessa(), &cen).expect("gera");
    let saida = cnab_core::separar_linhas(&g.conteudo);
    assert_eq!(saida[2].chars().skip(230).take(2).collect::<String>(), "00");
    assert_eq!(
        saida[3].chars().skip(230).take(4).collect::<String>(),
        "0102"
    );
}

#[test]
fn codigo_fora_do_catalogo_e_recusado_em_vez_de_escrito() {
    // Escrever um código que o banco não decodifica produz um arquivo que parece
    // certo e que o consumidor aprende a ler errado.
    let c = catalogo();
    let erro = gerar(retorno(&c), &remessa(), &cenario(&["ZZ"], &[])).unwrap_err();
    assert_eq!(
        erro,
        ErroDeGeracao::CodigoForaDoCatalogo {
            codigo: "ZZ".into()
        }
    );
}

#[test]
fn codigo_com_largura_errada_e_recusado() {
    let c = catalogo();
    let erro = gerar(retorno(&c), &remessa(), &cenario(&["001"], &[])).unwrap_err();
    assert!(matches!(erro, ErroDeGeracao::LarguraInvalida { .. }));
}

#[test]
fn nao_cabe_mais_ocorrencia_do_que_o_campo_comporta() {
    let c = catalogo();
    let erro = gerar(
        retorno(&c),
        &remessa(),
        &cenario(&["01", "02", "03", "04", "05", "06"], &[]),
    )
    .unwrap_err();
    assert_eq!(
        erro,
        ErroDeGeracao::OcorrenciasDemais {
            pedidas: 6,
            cabem: 5
        }
    );
}

#[test]
fn linha_que_nao_existe_no_arquivo_e_erro_de_cenario() {
    let c = catalogo();
    let mut cen = cenario(&["00"], &[]);
    cen.por_linha.insert(99, vec!["00".into()]);
    let erro = gerar(retorno(&c), &remessa(), &cen).unwrap_err();
    assert!(matches!(erro, ErroDeGeracao::LinhaInexistente { .. }));
}

#[test]
fn a_saida_sai_com_crlf() {
    // Gerar com LF produziria um arquivo que o próprio validador do banco recusa
    // linha a linha — o gerador estaria fabricando o defeito que o gate procura.
    let c = catalogo();
    let g = gerar(retorno(&c), &remessa(), &cenario(&["00"], &[])).expect("gera");
    assert!(g.conteudo.ends_with("\r\n"));
    assert!(!g.conteudo.contains("\n\n"));
    let lf_solto = g
        .conteudo
        .as_bytes()
        .windows(2)
        .filter(|w| w[1] == b'\n' && w[0] != b'\r')
        .count();
    assert_eq!(lf_solto, 0, "todo LF tem de vir precedido de CR");
}

#[test]
fn as_posicoes_vem_do_catalogo_e_nao_de_constante() {
    // Se o banco mudar a faixa, o gerador acompanha pelo mesmo caminho que o
    // resto do repositório — regenerar o spec. Este teste falha se alguém
    // trocar a leitura do catálogo por número escrito no código.
    let c = catalogo();
    let campo = campo_de_ocorrencias(retorno(&c)).expect("campo de ocorrências");
    assert_eq!(campo.colunas, [231, 240]);
    assert_eq!(campo.slots.len(), 5);
    assert!(campo.entradas.len() > 100);
    // A correção que destravou o gerador: sem `detalhe` aqui, ele escreveria
    // ocorrência em todo registro menos naquele que mais importa.
    assert!(campo.registros_lidos.iter().any(|r| r == "detalhe"));
}

#[test]
fn remessa_vazia_e_erro_e_nao_arquivo_vazio() {
    let c = catalogo();
    let erro = gerar(retorno(&c), &[], &cenario(&["00"], &[])).unwrap_err();
    assert_eq!(erro, ErroDeGeracao::RemessaVazia);
}

/// Congela um retorno gerado para o oráculo do lado Bun.
///
/// O decodificador oficial do banco é JavaScript e não roda daqui; `bun run
/// retorno-oraculo` o executa sobre este arquivo e confere que **o banco lê o
/// cenário que pedimos** — nenhum código no balde `desconhecido`, ocorrência no
/// detalhe *e* no envelope. É o mesmo arranjo de `bun run paridade`: o Rust
/// congela, o Bun confere contra o fonte.
#[test]
fn congela_exemplo_para_o_oraculo() {
    let c = catalogo();
    let campo = campo_de_ocorrencias(retorno(&c)).unwrap();
    // Um código de fatia única no detalhe e um universal no envelope: o par
    // exercita as duas coisas que o gerador precisa acertar.
    let so_primeira = campo
        .entradas
        .iter()
        .find(|e| e.slots == vec![1])
        .expect("código de fatia única");
    let universal = campo
        .entradas
        .iter()
        .find(|e| e.slots.len() == campo.slots.len())
        .expect("código universal");

    let cen = Cenario {
        padrao: vec![so_primeira.codigo.clone()],
        envelope: vec![universal.codigo.clone()],
        por_linha: BTreeMap::new(),
        ..Cenario::default()
    };
    let g = gerar(retorno(&c), &remessa(), &cen).expect("gera");

    let destino = raiz().join("tools/retorno-exemplo");
    std::fs::create_dir_all(&destino).expect("cria o diretório");
    std::fs::write(
        destino.join("multipag-cenario-misto.txt"),
        g.conteudo.chars().map(|c| c as u8).collect::<Vec<u8>>(),
    )
    .expect("grava o exemplo");
}
