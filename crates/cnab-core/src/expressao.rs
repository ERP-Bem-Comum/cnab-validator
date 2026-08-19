//! Avaliador das guardas, que a DSL não modela e o spec preserva como texto.
//!
//! Não é um interpretador de JavaScript: reconhece exatamente as formas que o
//! validador do Bradesco usa e **recusa** o resto. Guarda não reconhecida faz a
//! regra ser reportada como não avaliada — nunca como aprovada.
//!
//! É o espelho de `tools/spec-extractor/src/runner/expressao.ts`. Os dois
//! precisam concordar sobre o mesmo corpus, e é isso que o teste de paridade
//! verifica; divergir aqui é divergir do validador oficial.

use std::collections::HashMap;
use std::fmt;

use crate::valor::{Valor, comparar, numero_js};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpressaoNaoSuportada(pub String);

impl fmt::Display for ExpressaoNaoSuportada {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for ExpressaoNaoSuportada {}

pub struct Contexto<'a> {
    /// Linhas do arquivo, sem quebra de linha.
    pub linhas: &'a [String],
    /// Índice 0-based da linha corrente (`i` no fonte).
    pub i: usize,
    /// Variáveis já resolvidas — o dígito calculado antes do `if`, por exemplo.
    pub variaveis: HashMap<String, Valor>,
}

impl<'a> Contexto<'a> {
    pub fn novo(linhas: &'a [String], i: usize) -> Self {
        Self {
            linhas,
            i,
            variaveis: HashMap::new(),
        }
    }

    /// `res[k]` fora dos limites é texto vazio, não erro — o fonte não checa nada.
    pub fn linha(&self, indice: i64) -> &str {
        if indice < 0 {
            return "";
        }
        self.linhas
            .get(indice as usize)
            .map(String::as_str)
            .unwrap_or("")
    }
}

/// Recorte por posição de caractere, como `String.substring` do JavaScript:
/// índice além do fim devolve o que houver, sem estourar.
pub fn substring(texto: &str, inicio: usize, fim: usize) -> String {
    let (inicio, fim) = if inicio > fim {
        (fim, inicio)
    } else {
        (inicio, fim)
    };
    texto
        .chars()
        .skip(inicio)
        .take(fim.saturating_sub(inicio))
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Numero(f64),
    Texto(String),
    Nome(String),
    Regex(String),
    Simbolo(String),
}

const SIMBOLOS_DUPLOS: [&str; 8] = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||"];

fn tokenizar(fonte: &str) -> Result<Vec<Token>, ExpressaoNaoSuportada> {
    let chars: Vec<char> = fonte.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if c.is_whitespace() {
            i += 1;
            continue;
        }

        if c == '"' || c == '\'' {
            let mut valor = String::new();
            i += 1;
            while i < chars.len() && chars[i] != c {
                valor.push(chars[i]);
                i += 1;
            }
            if i >= chars.len() {
                return Err(ExpressaoNaoSuportada("string sem fechamento".into()));
            }
            i += 1;
            tokens.push(Token::Texto(valor));
            continue;
        }

        // `/\s/g` e `/\d/g` do `replace`: só estes dois aparecem no fonte.
        if c == '/' {
            let fim = (i + 1..chars.len()).find(|k| chars[*k] == '/');
            let Some(fim) = fim else {
                return Err(ExpressaoNaoSuportada("regex sem fechamento".into()));
            };
            let corpo: String = chars[i + 1..fim].iter().collect();
            i = fim + 1;
            while i < chars.len() && chars[i].is_ascii_lowercase() {
                i += 1;
            }
            tokens.push(Token::Regex(corpo));
            continue;
        }

        if c.is_ascii_digit() {
            let mut bruto = String::new();
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                bruto.push(chars[i]);
                i += 1;
            }
            tokens.push(Token::Numero(numero_js(&bruto)));
            continue;
        }

        if c.is_ascii_alphabetic() || c == '_' || c == '$' {
            let mut nome = String::new();
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '$')
            {
                nome.push(chars[i]);
                i += 1;
            }
            tokens.push(Token::Nome(nome));
            continue;
        }

        let resto: String = chars[i..].iter().collect();
        if let Some(duplo) = SIMBOLOS_DUPLOS.iter().find(|s| resto.starts_with(**s)) {
            tokens.push(Token::Simbolo((*duplo).to_string()));
            i += duplo.chars().count();
            continue;
        }

        if "()[].,+-*<>!%".contains(c) {
            tokens.push(Token::Simbolo(c.to_string()));
            i += 1;
            continue;
        }

        return Err(ExpressaoNaoSuportada(format!(
            "caractere não suportado: {c}"
        )));
    }

    Ok(tokens)
}

/// Variáveis que o fonte recalcula a cada linha e que aparecem nas guardas. São
/// **booleanas** sobre a linha corrente, não índices — o que explica a forma
/// `Header_arquivo < i > Trailer_arquivo`, cuja avaliação passa por duas
/// coerções.
fn contexto_de_linha(nome: &str, linha: &str) -> Option<bool> {
    match nome {
        "Header_arquivo" => Some(numero_js(&substring(linha, 3, 17)) == 0.0),
        "Trailer_arquivo" => Some(numero_js(&substring(linha, 3, 8)) == 99999.0),
        "Header_lote" => {
            Some(numero_js(&substring(linha, 7, 8)) == 1.0 && substring(linha, 8, 9) == "C")
        }
        "Trailer_lote" => Some(
            numero_js(&substring(linha, 7, 8)) == 5.0 && numero_js(&substring(linha, 8, 17)) == 0.0,
        ),
        _ => None,
    }
}

struct Parser<'a, 'ctx> {
    tokens: Vec<Token>,
    pos: usize,
    ctx: &'a Contexto<'ctx>,
}

impl<'a, 'ctx> Parser<'a, 'ctx> {
    fn avaliar(&mut self) -> Result<Valor, ExpressaoNaoSuportada> {
        let valor = self.ou()?;
        if self.pos < self.tokens.len() {
            return Err(ExpressaoNaoSuportada(
                "sobrou token depois da expressão".into(),
            ));
        }
        Ok(valor)
    }

    /// `&&` e `||` têm curto-circuito, como no fonte. Não é detalhe de
    /// desempenho: a guarda começa identificando o registro e só depois compara o
    /// dígito, então numa linha que não é aquele registro o validador nunca chega
    /// à parte que depende do cálculo. Avaliar os dois lados faria a regra ser
    /// recusada em toda linha do arquivo por uma expressão que o fonte não olha.
    fn ou(&mut self) -> Result<Valor, ExpressaoNaoSuportada> {
        let mut esquerda = self.e()?;
        while self.consumir_simbolo("||") {
            if esquerda.verdadeiro() {
                self.pular_operando(&["||"]);
                continue;
            }
            esquerda = self.e()?;
        }
        Ok(esquerda)
    }

    fn e(&mut self) -> Result<Valor, ExpressaoNaoSuportada> {
        let mut esquerda = self.comparacao()?;
        while self.consumir_simbolo("&&") {
            if !esquerda.verdadeiro() {
                self.pular_operando(&["&&", "||"]);
                continue;
            }
            esquerda = self.comparacao()?;
        }
        Ok(esquerda)
    }

    /// Associatividade à esquerda: `a < b > c` é `(a < b) > c`, como no
    /// JavaScript — e o resultado booleano volta a ser comparado como número.
    fn comparacao(&mut self) -> Result<Valor, ExpressaoNaoSuportada> {
        let mut esquerda = self.unario()?;
        loop {
            let Some(operador) = self.espiar_simbolo() else {
                return Ok(esquerda);
            };
            if !matches!(
                operador.as_str(),
                "===" | "!==" | "==" | "!=" | "<=" | ">=" | "<" | ">"
            ) {
                return Ok(esquerda);
            }
            self.pos += 1;
            let direita = self.unario()?;
            let resultado = comparar(&operador, &esquerda, &direita).ok_or_else(|| {
                ExpressaoNaoSuportada(format!("operador não suportado: {operador}"))
            })?;
            esquerda = Valor::Booleano(resultado);
        }
    }

    fn unario(&mut self) -> Result<Valor, ExpressaoNaoSuportada> {
        if self.consumir_simbolo("!") {
            return Ok(Valor::Booleano(!self.unario()?.verdadeiro()));
        }
        if self.consumir_simbolo("-") {
            return Ok(Valor::Numero(-self.unario()?.como_numero()));
        }
        let primario = self.primario()?;
        self.sufixos(primario)
    }

    fn primario(&mut self) -> Result<Valor, ExpressaoNaoSuportada> {
        let Some(token) = self.tokens.get(self.pos).cloned() else {
            return Err(ExpressaoNaoSuportada("expressão incompleta".into()));
        };

        match token {
            Token::Simbolo(ref s) if s == "(" => {
                self.pos += 1;
                let valor = self.ou()?;
                self.exigir_simbolo(")")?;
                Ok(valor)
            }
            // `[i + 3]` aparece como número de linha em mensagem; nas guardas, o
            // array literal de um elemento vale pelo elemento.
            Token::Simbolo(ref s) if s == "[" => {
                self.pos += 1;
                let valor = self.ou()?;
                self.exigir_simbolo("]")?;
                Ok(valor)
            }
            Token::Numero(n) => {
                self.pos += 1;
                Ok(Valor::Numero(n))
            }
            Token::Texto(t) => {
                self.pos += 1;
                Ok(Valor::Texto(t))
            }
            Token::Nome(nome) => {
                self.pos += 1;
                self.nome(&nome)
            }
            outro => Err(ExpressaoNaoSuportada(format!(
                "token inesperado: {outro:?}"
            ))),
        }
    }

    fn nome(&mut self, nome: &str) -> Result<Valor, ExpressaoNaoSuportada> {
        if nome == "res" {
            self.exigir_simbolo("[")?;
            let indice = self.aritmetica()?;
            self.exigir_simbolo("]")?;
            return Ok(Valor::texto(self.ctx.linha(indice as i64)));
        }

        if nome == "isNaN" {
            self.exigir_simbolo("(")?;
            let valor = self.ou()?;
            self.exigir_simbolo(")")?;
            return Ok(Valor::Booleano(valor.como_numero().is_nan()));
        }

        if nome == "i" {
            return Ok(Valor::Numero(self.ctx.i as f64));
        }
        // `j = i + 1` no fonte: é sempre a linha seguinte à corrente.
        if nome == "j" {
            return Ok(Valor::Numero(self.ctx.i as f64 + 1.0));
        }

        if let Some(booleano) = contexto_de_linha(nome, self.ctx.linha(self.ctx.i as i64)) {
            return Ok(Valor::Booleano(booleano));
        }

        if let Some(valor) = self.ctx.variaveis.get(nome) {
            return Ok(valor.clone());
        }

        // Chamada de função do fonte que o spec não modela — o CNPJ alfanumérico
        // é a que aparece aqui. Distinguir da variável não resolvida importa: uma
        // se fecha publicando o cálculo, a outra só extraindo a função.
        if self.espiar_simbolo().as_deref() == Some("(") {
            return Err(ExpressaoNaoSuportada(format!(
                "função do fonte não modelada: {nome}"
            )));
        }

        Err(ExpressaoNaoSuportada(format!(
            "identificador desconhecido: {nome}"
        )))
    }

    /// Índice de `res[...]`: aceita `i`, `0`, `i + 2`, `i - 1`.
    fn aritmetica(&mut self) -> Result<f64, ExpressaoNaoSuportada> {
        let mut valor = self.termo_aritmetico()?.como_numero();
        loop {
            if self.consumir_simbolo("+") {
                valor += self.termo_aritmetico()?.como_numero();
                continue;
            }
            if self.consumir_simbolo("-") {
                valor -= self.termo_aritmetico()?.como_numero();
                continue;
            }
            return Ok(valor);
        }
    }

    fn termo_aritmetico(&mut self) -> Result<Valor, ExpressaoNaoSuportada> {
        let Some(token) = self.tokens.get(self.pos).cloned() else {
            return Err(ExpressaoNaoSuportada("índice incompleto".into()));
        };
        match token {
            Token::Numero(n) => {
                self.pos += 1;
                Ok(Valor::Numero(n))
            }
            Token::Nome(nome) => {
                self.pos += 1;
                self.nome(&nome)
            }
            _ => Err(ExpressaoNaoSuportada("índice não suportado".into())),
        }
    }

    fn sufixos(&mut self, valor: Valor) -> Result<Valor, ExpressaoNaoSuportada> {
        let mut atual = valor;
        while self.consumir_simbolo(".") {
            let Some(Token::Nome(metodo)) = self.tokens.get(self.pos).cloned() else {
                return Err(ExpressaoNaoSuportada(
                    "acesso a propriedade não suportado".into(),
                ));
            };
            self.pos += 1;

            match metodo.as_str() {
                "length" => {
                    atual = Valor::Numero(atual.como_texto().chars().count() as f64);
                }
                "substring" => {
                    self.exigir_simbolo("(")?;
                    let inicio = self.aritmetica()?;
                    self.exigir_simbolo(",")?;
                    let fim = self.aritmetica()?;
                    self.exigir_simbolo(")")?;
                    atual = Valor::Texto(substring(
                        &atual.como_texto(),
                        inicio.max(0.0) as usize,
                        fim.max(0.0) as usize,
                    ));
                }
                "replace" => {
                    self.exigir_simbolo("(")?;
                    let Some(Token::Regex(padrao)) = self.tokens.get(self.pos).cloned() else {
                        return Err(ExpressaoNaoSuportada("replace sem padrão literal".into()));
                    };
                    self.pos += 1;
                    self.exigir_simbolo(",")?;
                    let substituto = self.ou()?;
                    self.exigir_simbolo(")")?;
                    atual = Valor::Texto(aplicar_replace(
                        &atual.como_texto(),
                        &padrao,
                        &substituto.como_texto(),
                    )?);
                }
                outro => {
                    return Err(ExpressaoNaoSuportada(format!(
                        "método não suportado: {outro}"
                    )));
                }
            }
        }
        Ok(atual)
    }

    /// Consome o operando que não será avaliado. Para no primeiro dos `ate` que
    /// estiver no nível externo de parênteses — o que estiver dentro de um grupo
    /// pertence ao operando descartado.
    fn pular_operando(&mut self, ate: &[&str]) {
        let mut nivel = 0i32;
        while self.pos < self.tokens.len() {
            if let Token::Simbolo(s) = &self.tokens[self.pos] {
                match s.as_str() {
                    "(" | "[" => nivel += 1,
                    ")" | "]" => {
                        if nivel == 0 {
                            return;
                        }
                        nivel -= 1;
                    }
                    outro if nivel == 0 && ate.contains(&outro) => return,
                    _ => {}
                }
            }
            self.pos += 1;
        }
    }

    fn espiar_simbolo(&self) -> Option<String> {
        match self.tokens.get(self.pos) {
            Some(Token::Simbolo(s)) => Some(s.clone()),
            _ => None,
        }
    }

    fn consumir_simbolo(&mut self, simbolo: &str) -> bool {
        if self.espiar_simbolo().as_deref() == Some(simbolo) {
            self.pos += 1;
            return true;
        }
        false
    }

    fn exigir_simbolo(&mut self, simbolo: &str) -> Result<(), ExpressaoNaoSuportada> {
        if self.consumir_simbolo(simbolo) {
            Ok(())
        } else {
            Err(ExpressaoNaoSuportada(format!("esperava {simbolo}")))
        }
    }
}

/// Só as duas classes que o fonte usa. Padrão diferente é recusado em vez de
/// aproximado: `replace` errado muda o resultado do teste residual.
pub fn aplicar_replace(
    texto: &str,
    padrao: &str,
    substituto: &str,
) -> Result<String, ExpressaoNaoSuportada> {
    let manter: fn(char) -> bool = match padrao {
        r"\s" => |c: char| !c.is_whitespace(),
        r"\d" => |c: char| !c.is_ascii_digit(),
        outro => {
            return Err(ExpressaoNaoSuportada(format!(
                "padrão de replace não suportado: {outro}"
            )));
        }
    };

    let mut saida = String::with_capacity(texto.len());
    for c in texto.chars() {
        if manter(c) {
            saida.push(c);
        } else {
            saida.push_str(substituto);
        }
    }
    Ok(saida)
}

/// Avalia a expressão do fonte. Devolve erro no que não reconhece.
pub fn avaliar_expressao(fonte: &str, ctx: &Contexto) -> Result<bool, ExpressaoNaoSuportada> {
    let tokens = tokenizar(fonte)?;
    let mut parser = Parser {
        tokens,
        pos: 0,
        ctx,
    };
    Ok(parser.avaliar()?.verdadeiro())
}

#[cfg(test)]
mod testes {
    use super::*;

    fn linhas(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn le_fora_dos_limites_como_texto_vazio() {
        let l = linhas(&["237"]);
        let ctx = Contexto::novo(&l, 0);
        assert!(avaliar_expressao(r#"res[9].substring(0, 3) == """#, &ctx).unwrap());
    }

    #[test]
    fn curto_circuita_como_o_javascript() {
        let l = linhas(&["237000"]);
        let ctx = Contexto::novo(&l, 0);
        assert!(
            !avaliar_expressao(
                r#"res[0].substring(0, 3) == "999" && res[0].substring(0, 1) == dv1"#,
                &ctx
            )
            .unwrap()
        );
        assert!(
            avaliar_expressao(r#"res[0].substring(0, 3) == "237" || naoExiste == 1"#, &ctx)
                .unwrap()
        );
        // Com a esquerda verdadeira o lado direito volta a ser exigido: o
        // curto-circuito não pode virar desculpa para aprovar o que não se sabe.
        assert!(
            avaliar_expressao(r#"res[0].substring(0, 3) == "237" && naoExiste == 1"#, &ctx)
                .is_err()
        );
    }

    #[test]
    fn reproduz_a_comparacao_encadeada_de_posicionamento() {
        // `Header_arquivo < i > Trailer_arquivo` é `(bool < i) > bool`, com duas
        // coerções: as variáveis são booleanas sobre a linha corrente.
        let l = linhas(&[
            "23700000000000000".to_string().as_str(),
            "23710000000000000",
            "23730000000000000",
            "237999990000000000",
        ]);
        let ctx0 = Contexto::novo(&l, 0);
        let ctx2 = Contexto::novo(&l, 2);
        assert!(!avaliar_expressao("Header_arquivo < i > Trailer_arquivo", &ctx0).unwrap());
        assert!(avaliar_expressao("Header_arquivo < i > Trailer_arquivo", &ctx2).unwrap());
    }

    #[test]
    fn recusa_o_que_nao_reconhece() {
        let l = linhas(&["237"]);
        let ctx = Contexto::novo(&l, 0);
        let erro = avaliar_expressao("funcaoDesconhecida(res[0]) == 1", &ctx).unwrap_err();
        assert!(erro.0.contains("função do fonte não modelada"));
    }

    #[test]
    fn resolve_variavel_fornecida() {
        let l = linhas(&["237"]);
        let mut ctx = Contexto::novo(&l, 0);
        ctx.variaveis.insert("banco".into(), Valor::Numero(237.0));
        assert!(avaliar_expressao("res[0].substring(0, 3) == banco", &ctx).unwrap());
    }

    #[test]
    fn replace_so_conhece_as_classes_do_fonte() {
        assert_eq!(aplicar_replace("  12  ", r"\s", "").unwrap(), "12");
        assert_eq!(aplicar_replace("a1b2", r"\d", "").unwrap(), "ab");
        assert!(aplicar_replace("x", r"\w", "").is_err());
    }
}
