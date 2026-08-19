//! Valores e comparações com a semântica do JavaScript.
//!
//! O validador do Bradesco compara o resultado de `substring()` — sempre texto —
//! ora com literal entre aspas, ora com literal numérico. No segundo caso o
//! JavaScript converte antes de comparar, e é por isso que um campo em branco
//! passa como zero e `" 1"` passa como `01`. Um motor que compare bytes reprova
//! arquivo que o oficial aprova, e vice-versa, sem aviso.
//!
//! Este módulo existe para reproduzir isso de propósito. Não é tolerância a
//! entrada malformada: é o comportamento do validador oficial, que é a fonte da
//! verdade deste repositório.

use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum Valor {
    Texto(String),
    Numero(f64),
    Booleano(bool),
}

impl Valor {
    pub fn texto(s: impl Into<String>) -> Self {
        Valor::Texto(s.into())
    }

    /// `Number(x)` do JavaScript.
    pub fn como_numero(&self) -> f64 {
        match self {
            Valor::Numero(n) => *n,
            Valor::Booleano(b) => {
                if *b {
                    1.0
                } else {
                    0.0
                }
            }
            Valor::Texto(s) => numero_js(s),
        }
    }

    /// `String(x)` do JavaScript, no que este motor usa.
    pub fn como_texto(&self) -> String {
        match self {
            Valor::Texto(s) => s.clone(),
            Valor::Booleano(b) => b.to_string(),
            Valor::Numero(n) => formatar_numero(*n),
        }
    }

    /// Veracidade do JavaScript: `""`, `0` e `NaN` são falsos.
    pub fn verdadeiro(&self) -> bool {
        match self {
            Valor::Booleano(b) => *b,
            Valor::Numero(n) => *n != 0.0 && !n.is_nan(),
            Valor::Texto(s) => !s.is_empty(),
        }
    }

    fn e_texto(&self) -> bool {
        matches!(self, Valor::Texto(_))
    }
}

impl fmt::Display for Valor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.como_texto())
    }
}

/// `Number(texto)` do JavaScript, restrito ao que aparece no fonte.
///
/// Só o essencial, e de propósito: texto vazio ou em branco vale zero — é o que
/// faz o campo não preenchido passar na comparação frouxa —, e o que não for um
/// literal decimal vira `NaN`. Formas que o JavaScript aceita e que não existem
/// em arquivo CNAB (`0x1f`, `Infinity`) ficam de fora para não abrir divergência
/// onde o fonte nunca chega.
pub fn numero_js(texto: &str) -> f64 {
    let limpo = texto.trim();
    if limpo.is_empty() {
        return 0.0;
    }
    if !parece_decimal(limpo) {
        return f64::NAN;
    }
    limpo.parse::<f64>().unwrap_or(f64::NAN)
}

fn parece_decimal(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;

    if matches!(bytes.first(), Some(b'+' | b'-')) {
        i = 1;
    }

    let mut digitos = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
        digitos += 1;
    }
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
            digitos += 1;
        }
    }
    if digitos == 0 {
        return false;
    }
    if i < bytes.len() && matches!(bytes[i], b'e' | b'E') {
        i += 1;
        if i < bytes.len() && matches!(bytes[i], b'+' | b'-') {
            i += 1;
        }
        let mut expoente = 0;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
            expoente += 1;
        }
        if expoente == 0 {
            return false;
        }
    }

    i == bytes.len()
}

/// `String(numero)` do JavaScript para os inteiros que o motor produz. O fonte
/// compara dígito calculado com faixa lida, e `11 - resto` é sempre inteiro.
fn formatar_numero(n: f64) -> String {
    if n.is_nan() {
        return "NaN".to_string();
    }
    if n == n.trunc() && n.is_finite() {
        return format!("{}", n as i64);
    }
    format!("{n}")
}

/// `==` do JavaScript entre os tipos que o fonte usa.
///
/// Texto contra texto compara texto. Qualquer mistura com número converte os
/// dois lados — é o coração da comparação frouxa.
pub fn igual_js(a: &Valor, b: &Valor) -> bool {
    match (a.e_texto(), b.e_texto()) {
        (true, true) => a.como_texto() == b.como_texto(),
        _ => {
            let (x, y) = (a.como_numero(), b.como_numero());
            x == y
        }
    }
}

/// `<`, `>`, `<=`, `>=` do JavaScript.
///
/// Com os dois lados em texto a comparação é lexicográfica — é o que sustenta o
/// `>= 'a' && <= 'z'` com que o fonte rejeita minúscula no dígito. Com um lado
/// numérico, os dois viram número, e `NaN` faz qualquer relacional ser falso.
pub fn relacional_js(operador: &str, a: &Valor, b: &Valor) -> bool {
    if a.e_texto() && b.e_texto() {
        let (x, y) = (a.como_texto(), b.como_texto());
        return match operador {
            "<" => x < y,
            ">" => x > y,
            "<=" => x <= y,
            ">=" => x >= y,
            _ => false,
        };
    }

    let (x, y) = (a.como_numero(), b.como_numero());
    if x.is_nan() || y.is_nan() {
        return false;
    }
    match operador {
        "<" => x < y,
        ">" => x > y,
        "<=" => x <= y,
        ">=" => x >= y,
        _ => false,
    }
}

/// Aplica um operador de comparação do fonte. Devolve `None` para operador que
/// este motor não conhece — recusar é melhor que decidir errado.
pub fn comparar(operador: &str, a: &Valor, b: &Valor) -> Option<bool> {
    match operador {
        "==" => Some(igual_js(a, b)),
        "!=" => Some(!igual_js(a, b)),
        // `!==` colapsa em `!=` no spec; o que os separava virou `comparacao`.
        "===" => Some(estritamente_igual(a, b)),
        "!==" => Some(!estritamente_igual(a, b)),
        "<" | ">" | "<=" | ">=" => Some(relacional_js(operador, a, b)),
        _ => None,
    }
}

fn estritamente_igual(a: &Valor, b: &Valor) -> bool {
    match (a, b) {
        (Valor::Texto(x), Valor::Texto(y)) => x == y,
        (Valor::Numero(x), Valor::Numero(y)) => x == y,
        (Valor::Booleano(x), Valor::Booleano(y)) => x == y,
        _ => false,
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn campo_em_branco_vale_zero_na_comparacao_frouxa() {
        // `res[0].substring(3, 7) == 0` no fonte: `Number("    ")` é 0, então o
        // campo não preenchido **passa**. Comparar como texto diria o contrário.
        assert!(igual_js(&Valor::texto("    "), &Valor::Numero(0.0)));
        assert!(!igual_js(&Valor::texto("    "), &Valor::texto("0")));
    }

    #[test]
    fn espaco_a_esquerda_nao_impede_o_numero() {
        assert!(igual_js(&Valor::texto(" 1"), &Valor::Numero(1.0)));
        assert!(igual_js(&Valor::texto("01"), &Valor::Numero(1.0)));
    }

    #[test]
    fn texto_nao_numerico_vira_nan_e_nada_casa() {
        assert!(numero_js("12a").is_nan());
        assert!(!igual_js(&Valor::texto("12a"), &Valor::Numero(12.0)));
        assert!(!relacional_js(
            "<",
            &Valor::texto("12a"),
            &Valor::Numero(99.0)
        ));
    }

    #[test]
    fn texto_contra_texto_compara_lexicograficamente() {
        // É o que faz `>= 'a' && <= 'z'` rejeitar minúscula no dígito.
        assert!(relacional_js(">=", &Valor::texto("m"), &Valor::texto("a")));
        assert!(relacional_js("<=", &Valor::texto("m"), &Valor::texto("z")));
        assert!(!relacional_js(">=", &Valor::texto("M"), &Valor::texto("a")));
    }

    #[test]
    fn formas_que_o_javascript_aceita_mas_o_cnab_nao_tem_ficam_de_fora() {
        assert!(numero_js("0x1f").is_nan());
        assert!(numero_js("Infinity").is_nan());
        assert!(numero_js("1e3") == 1000.0);
    }

    #[test]
    fn operador_desconhecido_e_recusado_em_vez_de_decidido() {
        assert_eq!(comparar("=~", &Valor::texto("a"), &Valor::texto("a")), None);
    }
}
