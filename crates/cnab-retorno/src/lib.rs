//! Gerador de arquivo de retorno, dirigido pelo catálogo extraído do banco.
//!
//! # O que ele é
//!
//! Uma **transformação `remessa → retorno`**: o arquivo de retorno do CNAB de
//! pagamento é a remessa devolvida com as ocorrências preenchidas. Nada é gerado
//! do zero — banco, lote, sequenciais, favorecido, valores e datas são copiados
//! da remessa, e só o que pertence ao retorno é escrito.
//!
//! # O que ele não é
//!
//! **Não é um simulador do banco.** O JavaScript público do Bradesco valida
//! remessa e decodifica retorno; ele não contém "dado este pagamento, o banco
//! responde X" — saldo, agendamento, efetivação, recusa por conta inexistente.
//! Essa lógica é do processamento interno e não é derivável do fonte.
//!
//! Quem escolhe o desfecho é quem chama, pelo [`Cenario`]. Este crate garante a
//! **forma**: que os códigos existam no catálogo do banco, que sejam escritos nas
//! posições e fatias que o validador lê, e nos registros em que ele os lê.
//!
//! Isso é o que quebra em integração de retorno — posição de campo, código não
//! tratado, ocorrência múltipla lida como única, envelope recusado que o
//! consumidor varre só no detalhe.
//!
//! # De onde vêm as posições
//!
//! Do `CampoDominio` de ocorrências do spec de retorno, não de constante: a faixa,
//! as **cinco fatias**, os **142 códigos** válidos e os **registros em que o campo
//! é lido**. Constante copiada diverge do banco na primeira atualização dele — é o
//! defeito que este repositório inteiro existe para não ter.

use std::collections::BTreeMap;

use cnab_specs::{CampoDominio, Layout};
use serde::{Deserialize, Serialize};

/// Nome do campo de ocorrências no catálogo.
const CAMPO_OCORRENCIAS: &str = "ocorrencias";

/// Posição 0-based do **código de remessa/retorno** no header de arquivo.
///
/// Os dois validadores do banco leem esta posição, e é assim que se sabe onde ela
/// fica: o de remessa exige `1` ali (`substring(142, 143) != 1` → "Código de
/// remessa inválido. Informar 1") e o de retorno avisa **"ARQUIVO É REMESSA"**
/// quando encontra `1`. Sem virar este byte, o arquivo gerado é lido pelo próprio
/// banco como uma remessa devolvida por engano — foi o primeiro defeito que o
/// oráculo pegou.
const CODIGO_REMESSA_RETORNO: usize = 142;

/// O que escrever ali para o arquivo deixar de ser remessa.
///
/// **É a única informação deste crate que não vem do fonte.** O JavaScript do
/// banco só afirma que `1` significa remessa; nenhum dos dois validadores diz
/// qual é o valor de retorno. `2` é o do padrão FEBRABAN, e o [`Cenario`] permite
/// trocá-lo — a fronteira fica declarada em vez de escondida numa constante que
/// parece extraída.
const CODIGO_RETORNO_PADRAO: &str = "2";

/// O desfecho que se quer simular, por registro.
///
/// As ocorrências são uma **lista**, não um código: o campo carrega cinco de dois
/// dígitos concatenados, e o que se perde ao tratá-lo como um só costuma ser a
/// causa secundária da recusa.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cenario {
    /// Ocorrências de todo registro de detalhe que não tenha override.
    #[serde(default)]
    pub padrao: Vec<String>,
    /// Ocorrências por número de linha (1-based, como as mensagens do validador).
    #[serde(default)]
    pub por_linha: BTreeMap<usize, Vec<String>>,
    /// Ocorrências do envelope — header e trailer, de arquivo e de lote.
    ///
    /// Separado do detalhe de propósito: recusa de envelope é o caso que um
    /// consumidor que varre só o detalhe não enxerga, e simular isso é metade da
    /// razão de este gerador existir.
    #[serde(default)]
    pub envelope: Vec<String>,
    /// Valor do código de remessa/retorno (coluna 143 do header de arquivo).
    ///
    /// Default `2`. É o único campo cujo valor não sai do fonte do banco.
    #[serde(default = "codigo_retorno_padrao")]
    pub codigo_retorno: String,
}

fn codigo_retorno_padrao() -> String {
    CODIGO_RETORNO_PADRAO.to_string()
}

impl Default for Cenario {
    fn default() -> Self {
        Self {
            padrao: Vec::new(),
            por_linha: BTreeMap::new(),
            envelope: Vec::new(),
            codigo_retorno: codigo_retorno_padrao(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Geracao {
    /// O arquivo de retorno, com CRLF — que é o que o banco exige e o que o
    /// consumidor vai receber.
    pub conteudo: String,
    /// O que foi escrito, linha a linha, para conferência.
    pub escritas: Vec<Escrita>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Escrita {
    pub linha: usize,
    pub registro: String,
    pub ocorrencias: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ErroDeGeracao {
    /// O layout de retorno não traz o campo de ocorrências.
    SemCampoDeOcorrencias,
    /// Código que o validador do banco não decodifica. Escrever um deles
    /// produziria um arquivo que *parece* certo e que o banco lê como
    /// desconhecido — exatamente o que o catálogo existe para evitar.
    CodigoForaDoCatalogo { codigo: String },
    /// Código que existe no catálogo mas **não naquela fatia**.
    ///
    /// O fonte não decodifica todos os códigos em todas as cinco: `00` — "Débito
    /// Efetivado", o código mais provável num cenário de sucesso — só é
    /// reconhecido na primeira. Escrito na terceira, o banco o leria como
    /// desconhecido, e o arquivo passaria por qualquer inspeção visual.
    CodigoForaDaFatia {
        codigo: String,
        fatia: u32,
        reconhecido_em: Vec<u32>,
    },
    /// Mais códigos do que o campo comporta.
    OcorrenciasDemais { pedidas: usize, cabem: usize },
    /// Código com largura diferente da fatia que o receberia.
    LarguraInvalida { codigo: String, esperada: usize },
    /// Linha citada no cenário que não existe no arquivo.
    LinhaInexistente { linha: usize, total: usize },
    /// Remessa sem nenhuma linha.
    RemessaVazia,
}

impl std::fmt::Display for ErroDeGeracao {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SemCampoDeOcorrencias => write!(
                f,
                "o layout de retorno não traz o campo de ocorrências; sem ele não há onde escrever"
            ),
            Self::CodigoForaDoCatalogo { codigo } => write!(
                f,
                "o código '{codigo}' não é decodificado pelo validador do banco: \
                 ele o leria como desconhecido"
            ),
            Self::CodigoForaDaFatia {
                codigo,
                fatia,
                reconhecido_em,
            } => write!(
                f,
                "o código '{codigo}' não é decodificado na fatia {fatia}; o fonte o \
                 reconhece em {reconhecido_em:?}"
            ),
            Self::OcorrenciasDemais { pedidas, cabem } => write!(
                f,
                "o campo comporta {cabem} ocorrências e foram pedidas {pedidas}"
            ),
            Self::LarguraInvalida { codigo, esperada } => write!(
                f,
                "o código '{codigo}' não tem os {esperada} dígitos da fatia"
            ),
            Self::LinhaInexistente { linha, total } => {
                write!(f, "o cenário cita a linha {linha}, e o arquivo tem {total}")
            }
            Self::RemessaVazia => write!(f, "a remessa não tem nenhuma linha"),
        }
    }
}

impl std::error::Error for ErroDeGeracao {}

/// Gera o retorno de uma remessa.
///
/// `layout_retorno` é o catálogo (`retorno-multipag`), de onde saem as posições e
/// o domínio; `linhas` é a remessa já separada.
pub fn gerar(
    layout_retorno: &Layout,
    linhas: &[String],
    cenario: &Cenario,
) -> Result<Geracao, ErroDeGeracao> {
    if linhas.is_empty() {
        return Err(ErroDeGeracao::RemessaVazia);
    }

    let campo = campo_de_ocorrencias(layout_retorno).ok_or(ErroDeGeracao::SemCampoDeOcorrencias)?;

    for (linha, codigos) in &cenario.por_linha {
        if *linha == 0 || *linha > linhas.len() {
            return Err(ErroDeGeracao::LinhaInexistente {
                linha: *linha,
                total: linhas.len(),
            });
        }
        conferir(codigos, campo)?;
    }
    conferir(&cenario.padrao, campo)?;
    conferir(&cenario.envelope, campo)?;

    let mut saida = Vec::with_capacity(linhas.len());
    let mut escritas = Vec::new();

    for (indice, linha) in linhas.iter().enumerate() {
        let numero = indice + 1;
        let registro = tipo_de_registro(linha);

        // O campo só é escrito onde o validador o lê. Fora daí, escrever seria
        // inventar conteúdo numa faixa que o banco não decodifica ali.
        let lido_aqui = campo
            .registros_lidos
            .iter()
            .any(|r| r == registro || (r == "detalhe" && registro == "detalhe"));

        let codigos = match cenario.por_linha.get(&numero) {
            Some(c) => c.clone(),
            None if registro == "detalhe" => cenario.padrao.clone(),
            None => cenario.envelope.clone(),
        };

        let mut atual = linha.clone();

        // O header de arquivo deixa de se declarar remessa. Sem isto o próprio
        // validador do banco lê o arquivo como remessa devolvida por engano.
        if registro == "header-arquivo" && !cenario.codigo_retorno.is_empty() {
            atual = marcar_como_retorno(&atual, &cenario.codigo_retorno);
        }

        if !lido_aqui || codigos.is_empty() {
            saida.push(atual);
            continue;
        }

        saida.push(escrever(&atual, campo, &codigos));
        escritas.push(Escrita {
            linha: numero,
            registro: registro.to_string(),
            ocorrencias: codigos,
        });
    }

    // CRLF, e uma quebra ao final: é o que o banco entrega e o que ele exige de
    // volta. Gerar com LF produziria um arquivo que o próprio validador recusa.
    let mut conteudo = saida.join("\r\n");
    conteudo.push_str("\r\n");

    Ok(Geracao { conteudo, escritas })
}

/// O campo de ocorrências do catálogo, que é de onde sai tudo que este crate sabe.
pub fn campo_de_ocorrencias(layout: &Layout) -> Option<&CampoDominio> {
    layout.campos.iter().find(|c| c.campo == CAMPO_OCORRENCIAS)
}

fn conferir(codigos: &[String], campo: &CampoDominio) -> Result<(), ErroDeGeracao> {
    if codigos.len() > campo.slots.len() {
        return Err(ErroDeGeracao::OcorrenciasDemais {
            pedidas: codigos.len(),
            cabem: campo.slots.len(),
        });
    }
    for (posicao, codigo) in codigos.iter().enumerate() {
        let largura = campo.slots[posicao].fim0 - campo.slots[posicao].inicio0;
        if codigo.chars().count() != largura {
            return Err(ErroDeGeracao::LarguraInvalida {
                codigo: codigo.clone(),
                esperada: largura,
            });
        }
        let Some(entrada) = campo.entradas.iter().find(|e| &e.codigo == codigo) else {
            return Err(ErroDeGeracao::CodigoForaDoCatalogo {
                codigo: codigo.clone(),
            });
        };
        // Existir no catálogo não basta: o fonte não decodifica todos os códigos
        // em todas as cinco fatias.
        let fatia = campo.slots[posicao].ordem;
        if !entrada.slots.contains(&fatia) {
            return Err(ErroDeGeracao::CodigoForaDaFatia {
                codigo: codigo.clone(),
                fatia,
                reconhecido_em: entrada.slots.clone(),
            });
        }
    }
    Ok(())
}

/// Escreve os códigos nas fatias do campo, preservando o resto da linha.
///
/// As fatias vazias ficam em **branco**, não em zero: `00` é um código que o
/// banco decodifica ("Débito Efetivado"), e preencher com ele diria algo que o
/// cenário não pediu.
fn escrever(linha: &str, campo: &CampoDominio, codigos: &[String]) -> String {
    let mut chars: Vec<char> = linha.chars().collect();
    let fim = campo.slots.iter().map(|s| s.fim0).max().unwrap_or(0);
    if chars.len() < fim {
        chars.resize(fim, ' ');
    }

    for (posicao, slot) in campo.slots.iter().enumerate() {
        let valor: Vec<char> = match codigos.get(posicao) {
            Some(codigo) => codigo.chars().collect(),
            None => vec![' '; slot.fim0 - slot.inicio0],
        };
        for (deslocamento, c) in valor.into_iter().enumerate() {
            chars[slot.inicio0 + deslocamento] = c;
        }
    }

    chars.into_iter().collect()
}

fn marcar_como_retorno(linha: &str, codigo: &str) -> String {
    let mut chars: Vec<char> = linha.chars().collect();
    if chars.len() <= CODIGO_REMESSA_RETORNO {
        return linha.to_string();
    }
    if let Some(c) = codigo.chars().next() {
        chars[CODIGO_REMESSA_RETORNO] = c;
    }
    chars.into_iter().collect()
}

/// Tipo de registro pela posição 008 do CNAB 240, que é a mesma taxonomia que o
/// spec usa em `registros_lidos`.
fn tipo_de_registro(linha: &str) -> &'static str {
    match linha.chars().nth(7) {
        Some('0') => "header-arquivo",
        Some('1') => "header-lote",
        Some('3') => "detalhe",
        Some('5') => "trailer-lote",
        Some('9') => "trailer-arquivo",
        _ => "nao-classificado",
    }
}
