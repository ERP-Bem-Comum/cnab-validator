//! Avaliação dos arquétipos da DSL sobre o arquivo.
//!
//! `None` significa **não avaliável** — é o que acontece com `custom` e com o que
//! depende de algo que o spec não carrega. Nunca devolver `Some(false)` nesses
//! casos é deliberado: regra silenciosamente aprovada cria falsa confiança.

use cnab_specs::{Condicao, ModoComparacao, Parcela, Posicao, SentidoDominio, VariavelDaGuarda};

use crate::expressao::{Contexto, aplicar_replace, substring};
use crate::valor::{Valor, comparar};

pub fn avaliar_condicao(condicao: &Condicao, ctx: &Contexto) -> Option<bool> {
    match condicao {
        Condicao::LiteralFixo {
            alvo,
            posicao,
            operador,
            valor,
            comparacao,
        } => {
            let campo = ler_faixa(alvo, posicao, ctx)?;
            comparar_literal(operador, &campo, valor, *comparacao)
        }

        Condicao::Dominio {
            alvo,
            posicao,
            valores,
            sentido,
            comparacao,
        } => {
            let campo = ler_faixa(alvo, posicao, ctx)?;
            let mut casa_algum = false;
            for valor in valores {
                casa_algum |= comparar_literal("==", &campo, valor, *comparacao)?;
            }
            // `permitidos` vem de conjunção de desigualdades: o erro é não casar
            // nenhum. `proibidos` vem de disjunção de igualdades: o erro é casar.
            Some(match sentido {
                SentidoDominio::Permitidos => !casa_algum,
                SentidoDominio::Proibidos => casa_algum,
            })
        }

        Condicao::Intervalo {
            alvo,
            posicao,
            limites,
            comparacao,
        } => {
            let campo = ler_faixa(alvo, posicao, ctx)?;
            let mut todos = true;
            for limite in limites {
                todos &= comparar_literal(&limite.operador, &campo, &limite.valor, *comparacao)?;
            }
            Some(todos)
        }

        Condicao::NumericoBranco {
            alvo,
            posicao,
            exige: _,
            residuo,
        } => {
            let campo = ler_faixa(alvo, posicao, ctx)?;
            let resto = aplicar_replace(&campo, &residuo.padrao, "").ok()?;
            let residual = Valor::Numero(resto.chars().count() as f64);
            let numerico_invalido = Valor::texto(&campo).como_numero().is_nan();
            let residual_falha = comparar(
                &residuo.operador,
                &residual,
                &Valor::Numero(residuo.valor as f64),
            )?;
            Some(numerico_invalido || residual_falha)
        }

        Condicao::CoerenciaRegistro {
            alvo,
            posicao,
            operador,
            outro,
            posicao_outro,
        } => {
            let campo = ler_faixa(alvo, posicao, ctx)?;
            let outro = ler_faixa(outro, posicao_outro, ctx)?;
            comparar(operador, &Valor::Texto(campo), &Valor::Texto(outro))
        }

        Condicao::TamanhoLinha {
            alvo,
            operador,
            tamanho,
        } => {
            let indice = resolver_indice(alvo, ctx)?;
            let comprimento = ctx.linha(indice).chars().count();
            comparar(
                operador,
                &Valor::Numero(comprimento as f64),
                &Valor::Numero(*tamanho as f64),
            )
        }

        Condicao::Modulo11 {
            alvo,
            posicao,
            base,
            modulo,
            resultado,
            transformacao,
            ..
        } => {
            // A função que o fonte aplica à faixa antes de comparar não está no
            // spec — sem ela, calcular seria inventar um resultado.
            if transformacao.is_some() {
                return None;
            }
            let esperado = calcular_digito(base, *modulo, resultado, ctx)?;
            let digito = ler_faixa(alvo, posicao, ctx)?;
            // O fonte compara sem aspas contra número e com aspas contra letra;
            // `==` cobre os dois com a mesma coerção que ele usa.
            Some(!crate::valor::igual_js(&Valor::Texto(digito), &esperado))
        }

        Condicao::Disjuncao { partes, .. } => {
            let mut algum = false;
            for parte in partes {
                algum |= avaliar_condicao(parte, ctx)?;
            }
            Some(algum)
        }

        Condicao::Conjuncao { partes, .. } => {
            let mut todos = true;
            for parte in partes {
                todos &= avaliar_condicao(parte, ctx)?;
            }
            Some(todos)
        }

        Condicao::Custom { .. } => None,
    }
}

fn comparar_literal(
    operador: &str,
    campo: &str,
    valor: &str,
    comparacao: ModoComparacao,
) -> Option<bool> {
    // Comparação frouxa é a do fonte contra literal sem aspas: o JavaScript
    // converte a faixa lida para número antes de comparar, e é isso que faz
    // `" 1"` passar como `01` e o campo em branco valer zero.
    let direita = match comparacao {
        ModoComparacao::Frouxa => Valor::Numero(crate::valor::numero_js(valor)),
        ModoComparacao::Estrita => Valor::texto(valor),
    };
    comparar(operador, &Valor::texto(campo), &direita)
}

/// Resto da soma ponderada, primeira metade do cálculo do dígito. O fonte também
/// o compara direto, sem virar dígito, para escolher qual regra aplicar.
pub fn calcular_resto(base: &[Parcela], modulo: i64, ctx: &Contexto) -> Option<f64> {
    if modulo == 0 {
        return None;
    }
    // A função que o fonte aplica a cada parcela do CNPJ alfanumérico não está no
    // spec — sem ela, calcular seria inventar um resultado.
    if base.iter().any(|p| p.transformacao.is_some()) {
        return None;
    }

    let mut soma = 0.0;
    for parcela in base {
        let campo = ler_faixa(
            &parcela.alvo,
            &Posicao {
                inicio0: parcela.inicio0,
                fim0: parcela.fim0,
            },
            ctx,
        )?;
        soma += Valor::texto(campo).como_numero() * parcela.peso as f64;
    }
    if soma.is_nan() {
        return None;
    }

    Some(soma % modulo as f64)
}

pub fn calcular_digito(
    base: &[Parcela],
    modulo: i64,
    resultado: &[cnab_specs::FaixaDeResto],
    ctx: &Contexto,
) -> Option<Valor> {
    let resto = calcular_resto(base, modulo, ctx)?;

    // A ordem do fonte é a ordem de avaliação: a última atribuição que casa vence.
    let mut esperado: Option<Valor> = None;
    for faixa in resultado {
        let casa = match (&faixa.operador, faixa.resto) {
            (Some(operador), Some(valor)) => comparar(
                operador,
                &Valor::Numero(resto),
                &Valor::Numero(valor as f64),
            )?,
            _ => true,
        };
        if !casa {
            continue;
        }

        if let Some(valor) = &faixa.valor {
            esperado = Some(Valor::texto(valor));
            continue;
        }
        esperado = Some(avaliar_valor(&faixa.expressao, resto)?);
    }

    esperado
}

/// Avalia uma expressão que devolve valor (não booleano), como `11 - resto`.
fn avaliar_valor(fonte: &str, resto: f64) -> Option<Valor> {
    let limpo = fonte.trim();

    if let Some(interno) = literal_entre_aspas(limpo) {
        return Some(Valor::texto(interno));
    }
    if let Ok(inteiro) = limpo.parse::<i64>() {
        return Some(Valor::Numero(inteiro as f64));
    }

    // `11 - resto`: a única forma de expressão que o fonte usa no dígito.
    let (esquerda, direita) = limpo.split_once('-')?;
    let base: f64 = esquerda.trim().parse().ok()?;
    if direita.trim() != "resto" {
        return None;
    }
    Some(Valor::Numero(base - resto))
}

fn literal_entre_aspas(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    if bytes.len() >= 2
        && (bytes[0] == b'"' || bytes[0] == b'\'')
        && bytes[bytes.len() - 1] == bytes[0]
        && !s[1..s.len() - 1].contains(bytes[0] as char)
    {
        return Some(&s[1..s.len() - 1]);
    }
    None
}

/// Resolve as variáveis que a guarda referencia. Variável que não se calcula fica
/// de fora, e a guarda que a cita passa a ser recusada por identificador
/// desconhecido — nunca aprovada com um valor inventado.
pub fn resolver_variaveis(variaveis: &[VariavelDaGuarda], ctx: &Contexto) -> Vec<(String, Valor)> {
    let mut resolvidas = Vec::new();
    for variavel in variaveis {
        let valor = match variavel {
            VariavelDaGuarda::Modulo11 {
                base,
                modulo,
                resultado,
                ..
            } => calcular_digito(base, *modulo, resultado, ctx),
            VariavelDaGuarda::Resto { base, modulo, .. } => {
                calcular_resto(base, *modulo, ctx).map(Valor::Numero)
            }
        };
        if let Some(valor) = valor {
            resolvidas.push((variavel.nome().to_string(), valor));
        }
    }
    resolvidas
}

fn ler_faixa(alvo: &str, posicao: &Posicao, ctx: &Contexto) -> Option<String> {
    let indice = resolver_indice(alvo, ctx)?;
    Some(substring(ctx.linha(indice), posicao.inicio0, posicao.fim0))
}

/// `res[i]`, `res[0]`, `res[i + 2]`, `res[j]` — o índice pode ser aritmético.
pub fn resolver_indice(alvo: &str, ctx: &Contexto) -> Option<i64> {
    let dentro = alvo.strip_prefix("res[")?.strip_suffix(']')?;
    indice_de(dentro.trim(), ctx)
}

fn indice_de(expressao: &str, ctx: &Contexto) -> Option<i64> {
    if let Ok(numero) = expressao.parse::<i64>() {
        return Some(numero);
    }

    if let Some((nome, resto)) = expressao.split_once(['+', '-']) {
        let operador = expressao.as_bytes()[nome.len()];
        let base = variavel_de_indice(nome.trim(), ctx)?;
        let passo: i64 = resto.trim().parse().ok()?;
        return Some(if operador == b'+' {
            base + passo
        } else {
            base - passo
        });
    }

    variavel_de_indice(expressao, ctx)
}

fn variavel_de_indice(nome: &str, ctx: &Contexto) -> Option<i64> {
    match nome {
        "i" => Some(ctx.i as i64),
        // `j = i + 1` no fonte.
        "j" => Some(ctx.i as i64 + 1),
        outro => match ctx.variaveis.get(outro) {
            Some(Valor::Numero(n)) => Some(*n as i64),
            _ => None,
        },
    }
}
