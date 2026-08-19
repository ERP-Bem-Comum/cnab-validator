//! O contrato dos specs, verificado contra os arquivos versionados.
//!
//! São invariantes estruturais, não asserções de contagem: o número de regras
//! muda a cada melhoria do extrator, e travar o número aqui só produziria um
//! teste que falha por motivo errado. O que não pode mudar sem alguém decidir é
//! a **forma**.

use std::path::PathBuf;

use cnab_specs::{Catalogo, Condicao, TipoLayout, VariavelDaGuarda};

fn specs_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tools/specs")
}

fn catalogo() -> Catalogo {
    Catalogo::carregar(specs_dir()).expect("os specs versionados têm de casar com o contrato")
}

#[test]
fn carrega_todos_os_layouts_do_indice() {
    let catalogo = catalogo();
    assert_eq!(
        catalogo.layouts().count(),
        catalogo.indice.layouts.len(),
        "todo layout apontado pelo índice tem de estar carregado"
    );
}

#[test]
fn o_indice_conta_o_que_os_layouts_carregam() {
    let catalogo = catalogo();
    assert_eq!(catalogo.indice.total_regras, catalogo.total_regras());

    for entrada in &catalogo.indice.layouts {
        let layout = catalogo
            .layout(&entrada.layout)
            .unwrap_or_else(|| panic!("layout ausente: {}", entrada.layout));
        assert_eq!(
            entrada.total_regras,
            layout.regras.len(),
            "{}: índice e layout discordam da contagem",
            entrada.layout
        );
        assert_eq!(entrada.total_campos, layout.campos.len());
    }
}

#[test]
fn ids_sao_unicos_e_derivam_de_funcao_e_linha() {
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        let mut vistos = std::collections::BTreeSet::new();
        for regra in &layout.regras {
            assert!(vistos.insert(&regra.id), "id repetido: {}", regra.id);
            assert_eq!(
                regra.id,
                format!(
                    "{}:{}:{}",
                    layout.layout, regra.funcao_origem, regra.linha_fonte
                ),
                "o id tem de ser derivável, não atribuído"
            );
        }
    }
}

#[test]
fn id_de_campo_identifica_um_campo_so() {
    // A faixa não basta: o fonte decodifica as mesmas colunas em blocos
    // diferentes, com dicionários diferentes. Id repetido faz quem indexar por
    // id perder um catálogo inteiro sem perceber.
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        let mut vistos = std::collections::BTreeSet::new();
        for campo in &layout.campos {
            assert!(
                vistos.insert(&campo.id),
                "id de campo repetido: {}",
                campo.id
            );
        }
    }
}

#[test]
fn toda_regra_publica_a_condicao_do_fonte() {
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        for regra in &layout.regras {
            assert!(
                !regra.condicao_original.trim().is_empty(),
                "{}: sem condição original não há rastreabilidade ao fonte",
                regra.id
            );
        }
    }
}

#[test]
fn posicao_publicada_e_coerente_com_as_colunas() {
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        for regra in &layout.regras {
            for posicao in &regra.posicoes {
                assert!(
                    posicao.fim0 >= posicao.inicio0,
                    "{}: faixa invertida",
                    regra.id
                );
                assert_eq!(
                    posicao.tamanho,
                    posicao.fim0 - posicao.inicio0,
                    "{}: tamanho não bate com a faixa",
                    regra.id
                );
                assert_eq!(
                    posicao.colunas,
                    [posicao.inicio0 as u32 + 1, posicao.fim0 as u32],
                    "{}: colunas 1-based não derivam da faixa 0-based",
                    regra.id
                );
            }
        }
    }
}

#[test]
fn regra_sem_faixa_nao_inventa_posicao() {
    // Comprimento de linha não é sobre uma faixa. Publicar uma faria um motor
    // ler a coluna errada, então o contrato manda `posicoes: []` e `colunas: [0, 0]`.
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        for regra in &layout.regras {
            if regra.posicoes.is_empty() {
                assert_eq!(regra.colunas, [0, 0], "{}: faixa inventada", regra.id);
            }
        }
    }
}

#[test]
fn composta_nao_esconde_escape_hatch() {
    // Disjunção e conjunção só são publicadas quando todas as partes têm
    // arquétipo próprio: uma parte `custom` derruba a regra inteira para custom,
    // que é onde ela deve ficar visível.
    fn tem_custom(condicao: &Condicao) -> bool {
        match condicao {
            Condicao::Custom { .. } => true,
            Condicao::Disjuncao { partes, .. } | Condicao::Conjuncao { partes, .. } => {
                partes.iter().any(tem_custom)
            }
            _ => false,
        }
    }

    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        for regra in &layout.regras {
            if matches!(
                regra.condicao,
                Condicao::Disjuncao { .. } | Condicao::Conjuncao { .. }
            ) {
                assert!(
                    !tem_custom(&regra.condicao),
                    "{}: composta com parte custom",
                    regra.id
                );
            }
        }
    }
}

#[test]
fn modulo_11_traz_o_calculo_inteiro() {
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        for regra in &layout.regras {
            if let Condicao::Modulo11 {
                base,
                modulo,
                resultado,
                ..
            } = &regra.condicao
            {
                assert!(!base.is_empty(), "{}: soma ponderada vazia", regra.id);
                assert!(*modulo > 0, "{}: módulo inválido", regra.id);
                assert!(
                    !resultado.is_empty(),
                    "{}: sem resultado por faixa de resto",
                    regra.id
                );
            }
        }
    }
}

#[test]
fn variavel_de_guarda_e_citada_pela_guarda() {
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        for regra in &layout.regras {
            let Some(variaveis) = &regra.variaveis_guarda else {
                continue;
            };
            let guarda = regra
                .condicao_guarda
                .as_deref()
                .unwrap_or_else(|| panic!("{}: variável de guarda sem guarda", regra.id));

            for variavel in variaveis {
                assert!(
                    guarda.contains(variavel.nome()),
                    "{}: publica {} que a guarda não cita",
                    regra.id,
                    variavel.nome()
                );
                assert!(
                    !variavel.base().is_empty(),
                    "{}: {} sem soma ponderada",
                    regra.id,
                    variavel.nome()
                );
                assert!(variavel.modulo() > 0, "{}: módulo inválido", regra.id);
                if let VariavelDaGuarda::Modulo11 { resultado, .. } = variavel {
                    assert!(
                        !resultado.is_empty(),
                        "{}: dígito sem resultado por faixa de resto",
                        regra.id
                    );
                }
            }
        }
    }
}

#[test]
fn campo_de_dominio_nao_aprova_codigo_desconhecido() {
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        for campo in &layout.campos {
            assert_eq!(
                campo.fora_do_dominio, "desconhecido",
                "{}: código fora do catálogo não pode virar sucesso",
                campo.id
            );
            assert!(
                !campo.slots.is_empty(),
                "{}: campo sem fatia é campo ilegível",
                campo.id
            );
            // `registros_lidos` sai das tabelas irmãs que decodificam a posição
            // do tipo de registro no mesmo bloco do fonte, e nem todo bloco as
            // tem — vazio quer dizer indeterminado, não "nenhum". Onde ele é
            // indispensável é no campo de ocorrências: é por header e trailer
            // que a recusa de envelope chega, e quem varrer só o detalhe lê
            // "nenhum erro" num arquivo inteiro recusado.
            if campo.campo == "ocorrencias" {
                assert!(
                    campo
                        .registros_lidos
                        .iter()
                        .any(|r| r.starts_with("header")),
                    "{}: ocorrências sem header entre os registros lidos",
                    campo.id
                );
                assert!(
                    campo
                        .registros_lidos
                        .iter()
                        .any(|r| r.starts_with("trailer")),
                    "{}: ocorrências sem trailer entre os registros lidos",
                    campo.id
                );
            }
            for entrada in &campo.entradas {
                for slot in &entrada.slots {
                    assert!(
                        campo.slots.iter().any(|s| s.ordem == *slot),
                        "{}: código {} aponta fatia inexistente",
                        campo.id,
                        entrada.codigo
                    );
                }
            }
        }
    }
}

#[test]
fn layout_de_retorno_vive_de_campos_e_o_de_remessa_de_regras() {
    let catalogo = catalogo();
    for layout in catalogo.layouts() {
        match layout.tipo {
            TipoLayout::Retorno => assert!(
                !layout.campos.is_empty(),
                "{}: retorno sem campo decodificado",
                layout.layout
            ),
            TipoLayout::Remessa => assert!(
                !layout.regras.is_empty(),
                "{}: remessa sem regra",
                layout.layout
            ),
            TipoLayout::Infra => {}
        }
    }
}
