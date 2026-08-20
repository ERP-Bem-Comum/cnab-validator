//! Como o arquivo chega até o motor: bytes → texto → linhas.
//!
//! Duas coisas que o motor não faz, e que o validador oficial faz, moram aqui.

use serde::Serialize;

/// Decodifica o corpo como **ISO-8859-1**, byte a byte.
///
/// CNAB é formato de posição fixa contada em bytes, e o motor conta caracteres
/// (`chars()`). Em ASCII os dois coincidem; num arquivo latin-1 com acento — que
/// é o que emissores brasileiros produzem — decodificar como UTF-8 falharia ou,
/// pior, juntaria dois bytes num caractere e **deslocaria todas as colunas
/// seguintes** da linha. Latin-1 nunca falha e mantém byte 1 : 1 caractere, que é
/// a posição que o banco lê.
///
/// O preço é um acento sair trocado no eco da mensagem quando o arquivo for
/// realmente UTF-8. É o lado certo de errar: a coluna continua certa.
pub fn decodificar(bytes: &[u8]) -> String {
    bytes.iter().map(|b| *b as char).collect()
}

/// Delimitador de linha encontrado no arquivo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Delimitador {
    Crlf,
    Lf,
    Cr,
    /// Mais de um tipo no mesmo arquivo.
    Misto,
    /// Nenhuma quebra: o arquivo é uma linha só.
    Ausente,
}

/// O que o validador oficial exige do delimitador, e o que o arquivo traz.
///
/// **Esta checagem não vem do spec, e não poderia vir.** No fonte do banco ela
/// vive em `verificarDelimitadoresDeLinha`, fora das funções de layout que o
/// extrator percorre, e olha o **hex do arquivo inteiro** — não as linhas já
/// divididas. Sem ela um arquivo com LF passa aqui e é recusado linha a linha do
/// outro lado, que é o pior desfecho possível para um gate.
#[derive(Debug, Clone, Serialize)]
pub struct Conformidade {
    pub esperado: &'static str,
    pub encontrado: Delimitador,
    pub conforme: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observacao: Option<String>,
}

pub fn conferir_delimitador(texto: &str) -> Conformidade {
    let encontrado = detectar(texto);
    let conforme = matches!(encontrado, Delimitador::Crlf);
    Conformidade {
        esperado: "CRLF",
        encontrado,
        conforme,
        observacao: if conforme {
            None
        } else {
            Some(
                "O validador oficial checa o delimitador pelo conteúdo do arquivo inteiro, \
                 não pelas linhas já divididas: um arquivo sem CRLF é recusado linha a linha, \
                 do começo ao fim, mesmo que todo o resto esteja correto."
                    .to_string(),
            )
        },
    }
}

fn detectar(texto: &str) -> Delimitador {
    let bytes = texto.as_bytes();
    let mut crlf = 0usize;
    let mut lf = 0usize;
    let mut cr = 0usize;

    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' if bytes.get(i + 1) == Some(&b'\n') => {
                crlf += 1;
                i += 2;
                continue;
            }
            b'\r' => cr += 1,
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
    }

    match (crlf, lf, cr) {
        (0, 0, 0) => Delimitador::Ausente,
        (_, 0, 0) => Delimitador::Crlf,
        (0, _, 0) => Delimitador::Lf,
        (0, 0, _) => Delimitador::Cr,
        _ => Delimitador::Misto,
    }
}

/// Comprimentos de linha que destoam do que o layout declara.
///
/// O motor tem regra de `tamanho_linha` para alguns registros, mas ela vem do
/// fonte e não cobre todos. Isto é a conferência de envelope: um arquivo cujas
/// linhas não têm o comprimento do layout não é daquele layout, e validar campo a
/// campo produziria dezenas de achados que só dizem a mesma coisa.
pub fn linhas_fora_do_tamanho(linhas: &[String], tamanhos: &[usize]) -> Vec<LinhaForaDoTamanho> {
    if tamanhos.is_empty() {
        return Vec::new();
    }
    linhas
        .iter()
        .enumerate()
        .filter_map(|(i, linha)| {
            let tamanho = linha.chars().count();
            if tamanhos.contains(&tamanho) {
                return None;
            }
            Some(LinhaForaDoTamanho {
                linha: i + 1,
                tamanho,
                esperado: tamanhos.to_vec(),
            })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct LinhaForaDoTamanho {
    /// 1-based, como as mensagens do validador.
    pub linha: usize,
    pub tamanho: usize,
    pub esperado: Vec<usize>,
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn latin1_mantem_uma_posicao_por_byte() {
        // `Ç` é 0xC7 em latin-1 e dois bytes em UTF-8. Se fosse decodificado como
        // UTF-8, tudo depois dele andaria uma coluna — e o CNAB é posicional.
        let bytes = b"AB\xC7DE";
        let texto = decodificar(bytes);
        assert_eq!(texto.chars().count(), 5);
        assert_eq!(texto.chars().nth(3), Some('D'));
    }

    #[test]
    fn reconhece_os_delimitadores_que_importam() {
        assert_eq!(detectar("a\r\nb\r\n"), Delimitador::Crlf);
        assert_eq!(detectar("a\nb\n"), Delimitador::Lf);
        assert_eq!(detectar("a\rb\r"), Delimitador::Cr);
        assert_eq!(detectar("a\r\nb\n"), Delimitador::Misto);
        assert_eq!(detectar("linha unica"), Delimitador::Ausente);
    }

    #[test]
    fn lf_nao_e_conforme_e_diz_por_que() {
        let c = conferir_delimitador("a\nb\n");
        assert!(!c.conforme);
        assert!(c.observacao.is_some());

        let ok = conferir_delimitador("a\r\nb\r\n");
        assert!(ok.conforme);
        assert!(ok.observacao.is_none());
    }

    #[test]
    fn tamanho_de_linha_e_conferido_contra_o_layout() {
        let linhas = vec!["x".repeat(240), "y".repeat(100)];
        let fora = linhas_fora_do_tamanho(&linhas, &[240]);
        assert_eq!(fora.len(), 1);
        assert_eq!(fora[0].linha, 2);
        assert_eq!(fora[0].tamanho, 100);
    }

    #[test]
    fn layout_que_aceita_dois_tamanhos_nao_reclama_de_nenhum_deles() {
        let linhas = vec!["x".repeat(240), "y".repeat(400)];
        assert!(linhas_fora_do_tamanho(&linhas, &[240, 400]).is_empty());
    }
}
