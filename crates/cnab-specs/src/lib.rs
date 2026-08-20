//! Representação em Rust dos specs que o extrator publica em `tools/specs/`.
//!
//! Este crate não valida arquivo nenhum: ele **carrega o contrato**. O motor
//! (`cnab-core`) consome o que está aqui, e o extrator em Bun é quem produz.
//!
//! Duas decisões que valem por muitos comentários:
//!
//! - **`deny_unknown_fields` em tudo.** Campo novo no spec que ninguém aqui
//!   consumiu é exatamente o que se quer descobrir cedo: a compilação do lado
//!   Rust falha na carga, em vez de o motor ignorar em silêncio uma informação
//!   que o validador oficial usa. O custo de acompanhar é uma linha; o custo de
//!   não acompanhar é um gate que aprova o que o banco reprova.
//! - **Nada de variante "desconhecida".** Arquétipo que este crate não conhece
//!   faz a carga falhar. É a mesma regra que o runner segue do outro lado: nada
//!   é aprovado por omissão.
//!
//! Os nomes seguem o JSON, que é em português — traduzir aqui criaria um segundo
//! vocabulário para as mesmas coisas.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Faixa de colunas 1-based inclusiva, como as mensagens do validador reportam.
pub type Colunas = [u32; 2];

/// Modo de comparação do fonte.
///
/// O validador compara o resultado de `substring()` — sempre texto — ora contra
/// literal entre aspas, ora contra literal numérico. No segundo caso o
/// JavaScript coage os tipos, e um campo em branco passa a valer zero. Um motor
/// que compare bytes só reproduz o oficial se respeitar isto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModoComparacao {
    Estrita,
    Frouxa,
}

/// O que o fonte exige da faixa nas condições construídas com `isNaN(...) || ...`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExigenciaNumericoBranco {
    /// Sobra um caractere não numérico.
    Numerico,
    /// Nada sobra depois de tirar os espaços.
    NumericoPreenchido,
    /// Sobra conteúdo onde deveria haver branco.
    Branco,
}

/// `permitidos` vem de conjunção de desigualdades — erro quando o campo não é
/// nenhum dos valores. `proibidos` vem de disjunção de igualdades — erro quando
/// é algum deles. Ler `valores` sem olhar isto inverte a regra.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SentidoDominio {
    Permitidos,
    Proibidos,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Posicao {
    /// 0-based, espelhando `String.substring(a, b)` do JavaScript.
    pub inicio0: usize,
    /// 0-based **exclusivo**.
    pub fim0: usize,
}

impl Posicao {
    /// A faixa como o validador a reporta: 1-based inclusiva.
    pub fn colunas(&self) -> Colunas {
        [self.inicio0 as u32 + 1, self.fim0 as u32]
    }
}

/// Teste residual literal do fonte, preservado para reprodução byte a byte.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Residuo {
    pub padrao: String,
    pub operador: String,
    pub valor: i64,
}

/// Uma parcela da soma ponderada do dígito verificador.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Parcela {
    pub alvo: String,
    pub inicio0: usize,
    pub fim0: usize,
    pub peso: i64,
    /// Função que o fonte aplica à parcela antes de multiplicar, quando existe.
    /// Presente significa que o cálculo **não** é reproduzível: a função vive no
    /// fonte, não no spec.
    pub transformacao: Option<String>,
}

/// Dígito esperado por faixa de resto, na ordem em que o fonte decide.
///
/// A ordem é significativa: uma entrada sem `operador` é o valor padrão, que as
/// seguintes sobrescrevem — a última que casa vence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaixaDeResto {
    pub operador: Option<String>,
    pub resto: Option<i64>,
    /// Literal, quando o fonte atribui um literal.
    pub valor: Option<String>,
    /// Expressão do fonte com a variável de resto renomeada para `resto`.
    pub expressao: String,
}

/// Limite relacional de um intervalo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Limite {
    pub operador: String,
    pub valor: String,
}

/// Arquétipos da DSL. `Custom` é o escape hatch: regra que não casa com nenhum
/// matcher chega aqui com `condicao_original` preservada na regra.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case", deny_unknown_fields)]
pub enum Condicao {
    LiteralFixo {
        alvo: String,
        posicao: Posicao,
        /// Já resolvido: `!(a == b)` chega como `!=`.
        operador: String,
        valor: String,
        comparacao: ModoComparacao,
    },
    NumericoBranco {
        alvo: String,
        posicao: Posicao,
        exige: ExigenciaNumericoBranco,
        residuo: Residuo,
    },
    Dominio {
        alvo: String,
        posicao: Posicao,
        valores: Vec<String>,
        sentido: SentidoDominio,
        comparacao: ModoComparacao,
    },
    Intervalo {
        alvo: String,
        posicao: Posicao,
        limites: Vec<Limite>,
        comparacao: ModoComparacao,
    },
    #[serde(rename = "modulo_11")]
    Modulo11 {
        alvo: String,
        /// Faixa do dígito informado no arquivo.
        posicao: Posicao,
        base: Vec<Parcela>,
        modulo: i64,
        /// Redução por parcela do somatório. O nome do arquétipo é histórico —
        /// quem diz qual algoritmo é são `modulo` e este campo, e o dígito do
        /// código de barras do Segmento O é módulo 10 com redução.
        dobra: Option<Dobra>,
        resultado: Vec<FaixaDeResto>,
        /// Função aplicada à faixa antes de comparar, quando existe.
        transformacao: Option<String>,
        /// Nome da variável no fonte que carrega o dígito calculado.
        variavel: String,
        documento: String,
    },
    /// Duas leituras comparadas entre si: a mesma faixa em linhas distintas
    /// (`res[i]` contra `res[j]`), ou dois campos da mesma linha. O par
    /// (`alvo`, `outro`) diz se a comparação atravessa registros.
    CoerenciaRegistro {
        alvo: String,
        posicao: Posicao,
        operador: String,
        outro: String,
        posicao_outro: Posicao,
        /// Deslocamento constante que o fonte soma a um dos lados antes de
        /// comparar: o sequencial que avança de um em um (`- 1`), ou a
        /// quantidade de registros do lote descontando header e trailer (`- 2`).
        ///
        /// **Presença de ajuste muda o tipo da comparação.** Sem ele o fonte
        /// compara duas strings, byte a byte; com ele o `-` do JavaScript já
        /// converteu o lado ajustado para número, e o `==` coage o outro. Faixa
        /// não numérica vira `NaN`, que difere de tudo — é assim que o fonte
        /// reprova, e é o que o motor precisa reproduzir.
        ajuste: Option<i64>,
        ajuste_outro: Option<i64>,
    },
    /// Faixa comparada com a variável de fluxo do laço, não com um literal nem
    /// com outra faixa. É como o fonte confere a quantidade de registros do
    /// arquivo (`qtde_reg != qtde_linha`, com `qtde_linha = j`) e o sequencial
    /// de registro do CNAB 400.
    ///
    /// `j` vale `i + 1` no fonte, logo é o número 1-based da linha corrente. O
    /// motor resolve `fluxo` pelo mesmo caminho que já resolve `res[j]`: a
    /// convenção do laço é uma só, e duplicá-la em forma de número abriria
    /// espaço para as duas divergirem. A comparação é numérica — o fonte compara
    /// texto com número, e o `==` coage a faixa.
    NumeroDaLinha {
        alvo: String,
        posicao: Posicao,
        operador: String,
        /// Expressão de fluxo a que o lado direito se resolve: `i`, `j`, `i + 1`.
        fluxo: String,
        /// Nome que a condição escreve, quando o fonte passa por uma variável
        /// intermediária (`qtde_linha`). Igual a `fluxo` quando compara direto.
        variavel: String,
    },
    TamanhoLinha {
        alvo: String,
        operador: String,
        tamanho: usize,
    },
    /// `||` do fonte: erro quando qualquer parte vale.
    Disjuncao {
        alvo: String,
        partes: Vec<Condicao>,
    },
    /// `&&` do fonte: erro só quando todas as partes valem.
    Conjuncao {
        alvo: String,
        partes: Vec<Condicao>,
    },
    Custom {
        alvo: String,
    },
}

impl Condicao {
    pub fn alvo(&self) -> &str {
        match self {
            Condicao::LiteralFixo { alvo, .. }
            | Condicao::NumericoBranco { alvo, .. }
            | Condicao::Dominio { alvo, .. }
            | Condicao::Intervalo { alvo, .. }
            | Condicao::Modulo11 { alvo, .. }
            | Condicao::CoerenciaRegistro { alvo, .. }
            | Condicao::NumeroDaLinha { alvo, .. }
            | Condicao::TamanhoLinha { alvo, .. }
            | Condicao::Disjuncao { alvo, .. }
            | Condicao::Conjuncao { alvo, .. }
            | Condicao::Custom { alvo } => alvo,
        }
    }

    /// Nome do arquétipo como o spec o escreve. Útil em relatório e em métrica
    /// de cobertura, onde o que se conta é o tipo, não o conteúdo.
    pub fn tipo(&self) -> &'static str {
        match self {
            Condicao::LiteralFixo { .. } => "literal_fixo",
            Condicao::NumericoBranco { .. } => "numerico_branco",
            Condicao::Dominio { .. } => "dominio",
            Condicao::Intervalo { .. } => "intervalo",
            Condicao::Modulo11 { .. } => "modulo_11",
            Condicao::CoerenciaRegistro { .. } => "coerencia_registro",
            Condicao::NumeroDaLinha { .. } => "numero_da_linha",
            Condicao::TamanhoLinha { .. } => "tamanho_linha",
            Condicao::Disjuncao { .. } => "disjuncao",
            Condicao::Conjuncao { .. } => "conjuncao",
            Condicao::Custom { .. } => "custom",
        }
    }
}

/// Variável que a guarda referencia, resolvida como cálculo.
///
/// A guarda `res[0].substring(30, 31) == dv1` não diz nada sozinha: `dv1` é o
/// dígito que o fonte calculou antes do `if`. Sem isto, a regra que ela protege
/// — a do segundo dígito — não é avaliável.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "snake_case", deny_unknown_fields)]
pub enum VariavelDaGuarda {
    #[serde(rename = "modulo_11")]
    Modulo11 {
        nome: String,
        base: Vec<Parcela>,
        modulo: i64,
        dobra: Option<Dobra>,
        resultado: Vec<FaixaDeResto>,
    },
    /// O resto da divisão, sem virar dígito: o fonte compara faixas de resto
    /// entre si para escolher qual dígito exigir.
    Resto {
        nome: String,
        base: Vec<Parcela>,
        modulo: i64,
        dobra: Option<Dobra>,
    },
}

/// Redução aplicada a cada parcela quando o produto passa do limite — o módulo
/// 10 do código de barras, que o fonte escreve como um `if` por posição
/// (`if (faixa * 2 > 9) soma = (faixa * 2) - 9; else soma = faixa * 2`).
///
/// Os números vêm do fonte em vez de um nome de algoritmo: limite e valor
/// subtraído coincidem em 9 aqui, e assumir isso esconderia a diferença se o
/// banco mudar um dos dois. `None` é a soma ponderada direta do módulo 11.
///
/// A redução é **por parcela, antes de somar**: aplicá-la ao total daria outro
/// número.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Dobra {
    pub limite: i64,
    pub subtrai: i64,
}

impl VariavelDaGuarda {
    pub fn nome(&self) -> &str {
        match self {
            VariavelDaGuarda::Modulo11 { nome, .. } | VariavelDaGuarda::Resto { nome, .. } => nome,
        }
    }

    pub fn base(&self) -> &[Parcela] {
        match self {
            VariavelDaGuarda::Modulo11 { base, .. } | VariavelDaGuarda::Resto { base, .. } => base,
        }
    }

    pub fn modulo(&self) -> i64 {
        match self {
            VariavelDaGuarda::Modulo11 { modulo, .. } | VariavelDaGuarda::Resto { modulo, .. } => {
                *modulo
            }
        }
    }

    /// Redução por parcela, quando o cálculo a tem. O dígito nunca a tem: no
    /// fonte ela só aparece no somatório do módulo 10.
    pub fn dobra(&self) -> Option<Dobra> {
        match self {
            VariavelDaGuarda::Modulo11 { dobra, .. } | VariavelDaGuarda::Resto { dobra, .. } => {
                *dobra
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrigemRegistro {
    Guarda,
    Mensagem,
}

/// Faixa que uma condição lê, publicada por regra.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PosicaoLida {
    pub alvo: String,
    pub inicio0: usize,
    pub fim0: usize,
    pub colunas: Colunas,
    pub tamanho: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Regra {
    /// `<layout>:<funcao_origem>:<linha_fonte>` — determinístico.
    pub id: String,
    pub funcao_origem: String,
    /// Linha absoluta no arquivo original do banco.
    pub linha_fonte: u32,
    pub registro: String,
    pub registro_referenciado: Option<String>,
    pub registro_origem: Option<OrigemRegistro>,
    pub registro_alvo: Vec<String>,
    /// Faixa que a condição efetivamente lê — é o que um motor deve usar.
    pub colunas: Colunas,
    /// Faixa declarada na mensagem, quando difere de `colunas`.
    pub colunas_mensagem: Option<Colunas>,
    /// Vazio quando a regra não é sobre uma posição (comprimento de linha).
    pub posicoes: Vec<PosicaoLida>,
    pub condicao: Condicao,
    /// Conjunção completa (guardas + teste), para rastreabilidade ao fonte.
    pub condicao_original: String,
    /// Só as guardas dos `if` externos.
    pub condicao_guarda: Option<String>,
    pub variaveis_guarda: Option<Vec<VariavelDaGuarda>>,
    pub descricao: String,
    pub mensagem: String,
    pub natureza: String,
    pub severidade: String,
}

/// Fatia de um campo que carrega mais de um código concatenado.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Slot {
    pub ordem: u32,
    pub inicio0: usize,
    pub fim0: usize,
    pub colunas: Colunas,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntradaCampo {
    pub codigo: String,
    pub rotulo: String,
    /// Fatias que reconhecem este código.
    pub slots: Vec<u32>,
    pub condicao_extra: Option<String>,
    pub linha_fonte: u32,
}

/// Campo cujo conteúdo é decodificado por tabela em vez de validado por regra.
/// O arquivo de retorno é feito disto; os de remessa não têm nenhum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CampoDominio {
    pub id: String,
    pub campo: String,
    pub funcao_origem: String,
    pub colunas: Colunas,
    pub slots: Vec<Slot>,
    /// Tipos de registro em que o fonte lê o campo — inclui header e trailer.
    /// Quem varrer só o detalhe lê "nenhum erro" num arquivo inteiro recusado.
    pub registros_lidos: Vec<String>,
    /// Sempre `desconhecido`: código fora do catálogo nunca vira sucesso.
    pub fora_do_dominio: String,
    pub entradas: Vec<EntradaCampo>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TipoLayout {
    Remessa,
    Retorno,
    Infra,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Layout {
    pub layout: String,
    pub nome: String,
    pub tipo: TipoLayout,
    pub tamanhos_linha: Vec<usize>,
    pub regras: Vec<Regra>,
    pub campos: Vec<CampoDominio>,
}

impl Layout {
    /// Regras que valem para um tipo de registro. O motor precisa disto para não
    /// aplicar regra de header em linha de detalhe.
    pub fn regras_do_registro<'a>(&'a self, registro: &'a str) -> impl Iterator<Item = &'a Regra> {
        self.regras.iter().filter(move |r| r.registro == registro)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubLayout {
    pub funcao: String,
    pub regras: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntradaIndice {
    pub layout: String,
    pub nome: String,
    pub tipo: TipoLayout,
    pub tamanhos_linha: Vec<usize>,
    /// Caminho relativo ao diretório do índice.
    pub arquivo: String,
    pub total_regras: usize,
    pub total_campos: usize,
    pub total_codigos: usize,
    pub sub_layouts: Vec<SubLayout>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Indice {
    pub fonte: String,
    pub observacao: String,
    pub total_regras: usize,
    pub layouts: Vec<EntradaIndice>,
}

/// Índice e layouts carregados, prontos para o motor.
#[derive(Debug, Clone)]
pub struct Catalogo {
    pub indice: Indice,
    layouts: BTreeMap<String, Layout>,
}

impl Catalogo {
    /// Carrega `index.json` e todos os layouts que ele aponta.
    pub fn carregar(dir: impl AsRef<Path>) -> Result<Self, ErroDeCarga> {
        let dir = dir.as_ref();
        let caminho_indice = dir.join("index.json");
        let indice: Indice = ler_json(&caminho_indice)?;

        let mut layouts = BTreeMap::new();
        for entrada in &indice.layouts {
            let caminho = dir.join(&entrada.arquivo);
            let layout: Layout = ler_json(&caminho)?;
            if layout.layout != entrada.layout {
                return Err(ErroDeCarga::IndiceIncoerente {
                    caminho,
                    esperado: entrada.layout.clone(),
                    encontrado: layout.layout,
                });
            }
            layouts.insert(layout.layout.clone(), layout);
        }

        Ok(Self { indice, layouts })
    }

    pub fn layout(&self, nome: &str) -> Option<&Layout> {
        self.layouts.get(nome)
    }

    pub fn layouts(&self) -> impl Iterator<Item = &Layout> {
        self.layouts.values()
    }

    pub fn total_regras(&self) -> usize {
        self.layouts.values().map(|l| l.regras.len()).sum()
    }
}

fn ler_json<T: serde::de::DeserializeOwned>(caminho: &Path) -> Result<T, ErroDeCarga> {
    let conteudo = fs::read_to_string(caminho).map_err(|erro| ErroDeCarga::Leitura {
        caminho: caminho.to_path_buf(),
        erro,
    })?;
    serde_json::from_str(&conteudo).map_err(|erro| ErroDeCarga::Formato {
        caminho: caminho.to_path_buf(),
        erro,
    })
}

#[derive(Debug)]
pub enum ErroDeCarga {
    Leitura {
        caminho: PathBuf,
        erro: io::Error,
    },
    /// O JSON não casa com o contrato. Campo desconhecido cai aqui de propósito:
    /// é o sinal de que o extrator publicou algo que este crate ainda não lê.
    Formato {
        caminho: PathBuf,
        erro: serde_json::Error,
    },
    IndiceIncoerente {
        caminho: PathBuf,
        esperado: String,
        encontrado: String,
    },
}

impl fmt::Display for ErroDeCarga {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ErroDeCarga::Leitura { caminho, erro } => {
                write!(f, "não foi possível ler {}: {erro}", caminho.display())
            }
            ErroDeCarga::Formato { caminho, erro } => {
                write!(f, "{} não casa com o contrato: {erro}", caminho.display())
            }
            ErroDeCarga::IndiceIncoerente {
                caminho,
                esperado,
                encontrado,
            } => write!(
                f,
                "{} declara o layout {encontrado}, mas o índice o aponta como {esperado}",
                caminho.display()
            ),
        }
    }
}

impl std::error::Error for ErroDeCarga {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ErroDeCarga::Leitura { erro, .. } => Some(erro),
            ErroDeCarga::Formato { erro, .. } => Some(erro),
            ErroDeCarga::IndiceIncoerente { .. } => None,
        }
    }
}
