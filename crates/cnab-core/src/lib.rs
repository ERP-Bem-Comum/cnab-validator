//! Motor de validação sobre os specs extraídos do validador oficial.
//!
//! Aplica um spec a um arquivo e devolve os achados. Não faz I/O, não detecta
//! layout e não trata encoding — isso é da CLI e da API, que virão depois.
//!
//! O runner em TypeScript (`tools/spec-extractor/src/runner/`) faz a mesma coisa
//! e existe desde a Fase 0 como oráculo de teste. Os dois rodam sobre o mesmo
//! corpus e o diff entre eles é o teste de paridade: divergir de lá é divergir do
//! validador do banco, porque foi contra ele que o runner foi medido.
//!
//! **Nada é aprovado por omissão.** Condição `custom`, condição que depende de
//! algo que o spec não carrega e guarda que o avaliador não reconhece viram *não
//! avaliadas*, com contagem. Regra silenciosamente ignorada cria falsa confiança.

pub mod condicao;
pub mod expressao;
pub mod valor;

use std::collections::BTreeMap;

use cnab_specs::{Colunas, Regra};
use serde::{Deserialize, Serialize};

use crate::condicao::{avaliar_condicao, resolver_indice, resolver_variaveis};
use crate::expressao::{Contexto, avaliar_expressao};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Achado {
    pub regra_id: String,
    /// Número da linha, 1-based, como o validador oficial reporta.
    pub linha: usize,
    pub registro: String,
    pub colunas: Colunas,
    pub mensagem: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotivoNaoAvaliada {
    /// A condição é `custom`: o extrator não modelou o teste.
    CondicaoCustom,
    /// A condição tem arquétipo, mas depende de algo que o spec não carrega.
    CondicaoIncompleta,
    /// A guarda usa forma que o avaliador não reconhece.
    GuardaNaoAvaliavel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NaoAvaliada {
    pub regra_id: String,
    pub motivo: MotivoNaoAvaliada,
    /// Em quantas linhas a regra deixou de ser avaliada.
    pub ocorrencias: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detalhe: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Relatorio {
    pub achados: Vec<Achado>,
    pub nao_avaliadas: Vec<NaoAvaliada>,
    /// Regras avaliadas ao menos uma vez sem recusa.
    pub regras_avaliadas: usize,
    pub total_regras: usize,
    pub linhas: usize,
}

/// Divide o arquivo como o validador faz: por quebra de linha, sem tocar no
/// conteúdo. Uma linha final vazia (arquivo terminado em quebra) não é registro.
pub fn separar_linhas(conteudo: &str) -> Vec<String> {
    let mut linhas: Vec<String> = conteudo
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();
    while linhas.last().is_some_and(String::is_empty) {
        linhas.pop();
    }
    linhas
}

pub fn aplicar_spec(regras: &[Regra], linhas: &[String]) -> Relatorio {
    let mut achados = Vec::new();
    let mut nao_avaliadas: BTreeMap<(String, MotivoNaoAvaliada), NaoAvaliada> = BTreeMap::new();
    let mut avaliadas = std::collections::BTreeSet::new();

    let mut registrar = |regra: &Regra, motivo: MotivoNaoAvaliada, detalhe: Option<String>| {
        nao_avaliadas
            .entry((regra.id.clone(), motivo))
            .and_modify(|n| n.ocorrencias += 1)
            .or_insert(NaoAvaliada {
                regra_id: regra.id.clone(),
                motivo,
                ocorrencias: 1,
                detalhe,
            });
    };

    for regra in regras {
        for i in linhas_da_regra(regra, linhas) {
            let mut ctx = Contexto::novo(linhas, i);
            // As variáveis da guarda dependem do conteúdo da linha, então são
            // recalculadas a cada uma — como o fonte faz.
            if let Some(variaveis) = &regra.variaveis_guarda {
                ctx.variaveis = resolver_variaveis(variaveis, &ctx).into_iter().collect();
            }

            if let Some(guarda) = &regra.condicao_guarda {
                match avaliar_expressao(guarda, &ctx) {
                    Ok(false) => continue,
                    Ok(true) => {}
                    Err(erro) => {
                        registrar(
                            regra,
                            MotivoNaoAvaliada::GuardaNaoAvaliavel,
                            Some(erro.0.clone()),
                        );
                        continue;
                    }
                }
            }

            let Some(resultado) = avaliar_condicao(&regra.condicao, &ctx) else {
                let motivo = if matches!(regra.condicao, cnab_specs::Condicao::Custom { .. }) {
                    MotivoNaoAvaliada::CondicaoCustom
                } else {
                    MotivoNaoAvaliada::CondicaoIncompleta
                };
                registrar(regra, motivo, None);
                continue;
            };

            avaliadas.insert(regra.id.clone());
            if resultado {
                let linha = linha_relatada(regra, i);
                achados.push(Achado {
                    regra_id: regra.id.clone(),
                    linha,
                    registro: regra.registro.clone(),
                    colunas: regra.colunas,
                    mensagem: preencher_mensagem(&regra.mensagem, linha),
                });
            }
        }
    }

    Relatorio {
        achados,
        nao_avaliadas: nao_avaliadas.into_values().collect(),
        regras_avaliadas: avaliadas.len(),
        total_regras: regras.len(),
        linhas: linhas.len(),
    }
}

/// Sobre quais linhas a regra roda. Regra cujo alvo é uma linha fixa (`res[0]`) é
/// avaliada uma vez só — o fonte a escreve fora do laço, e repeti-la por linha
/// produziria o mesmo achado N vezes.
fn linhas_da_regra(regra: &Regra, linhas: &[String]) -> Vec<usize> {
    let alvo = regra
        .registro_alvo
        .first()
        .map(String::as_str)
        .unwrap_or("res[0]");
    if let Some(fixo) = indice_fixo(alvo) {
        return vec![fixo];
    }
    (0..linhas.len()).collect()
}

fn indice_fixo(alvo: &str) -> Option<usize> {
    let dentro = alvo.strip_prefix("res[")?.strip_suffix(']')?;
    dentro.trim().parse::<usize>().ok()
}

/// A linha que a mensagem reporta é a do alvo, que nem sempre é a linha corrente.
fn linha_relatada(regra: &Regra, i: usize) -> usize {
    let alvo = regra
        .registro_alvo
        .first()
        .map(String::as_str)
        .unwrap_or("res[0]");
    let vazio: Vec<String> = Vec::new();
    let ctx = Contexto::novo(&vazio, i);
    match resolver_indice(alvo, &ctx) {
        Some(indice) if indice >= 0 => indice as usize + 1,
        _ => i + 1,
    }
}

fn preencher_mensagem(mensagem: &str, linha: usize) -> String {
    mensagem.replace("{linha}", &linha.to_string())
}
