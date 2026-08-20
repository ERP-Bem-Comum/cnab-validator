import type { DslCondition } from "../rule-mapper.js";
import {
  aplicarComparacao,
  avaliarExpressao,
  ExpressaoNaoSuportada,
  linhaDe,
  type ContextoArquivo,
  type Valor,
} from "./expressao.js";

/**
 * Avalia um arquétipo da DSL sobre o arquivo. `null` significa **não avaliável** —
 * é o que acontece com `custom` e com o que depende de coisa que o spec não
 * carrega. Nunca devolver `false` nesses casos é deliberado: regra silenciosamente
 * aprovada cria falsa confiança.
 */
export function avaliarCondicao(
  condicao: DslCondition,
  ctx: ContextoArquivo
): boolean | null {
  switch (condicao.tipo) {
    case "literal_fixo": {
      const campo = lerFaixa(condicao.alvo, condicao.posicao, ctx);
      if (campo === null) return null;
      return comparar(condicao.operador, campo, condicao.valor, condicao.comparacao);
    }

    case "dominio": {
      const campo = lerFaixa(condicao.alvo, condicao.posicao, ctx);
      if (campo === null) return null;
      const casaAlgum = condicao.valores.some((valor) =>
        comparar("==", campo, valor, condicao.comparacao)
      );
      // `permitidos` vem de uma conjunção de desigualdades: o erro é não casar
      // nenhum. `proibidos` vem de uma disjunção de igualdades: o erro é casar.
      return condicao.sentido === "permitidos" ? !casaAlgum : casaAlgum;
    }

    case "intervalo": {
      const campo = lerFaixa(condicao.alvo, condicao.posicao, ctx);
      if (campo === null) return null;
      return condicao.limites.every((limite) =>
        comparar(limite.operador, campo, limite.valor, condicao.comparacao)
      );
    }

    case "numerico_branco": {
      const campo = lerFaixa(condicao.alvo, condicao.posicao, ctx);
      if (campo === null) return null;
      const residuo = campo.replace(new RegExp(condicao.residuo.padrao, "g"), "").length;
      return (
        isNaN(Number(campo)) ||
        aplicarComparacao(condicao.residuo.operador, residuo, condicao.residuo.valor)
      );
    }

    case "coerencia_registro": {
      const campo = lerFaixa(condicao.alvo, condicao.posicao, ctx);
      const outro = lerFaixa(condicao.outro, condicao.posicao_outro, ctx);
      if (campo === null || outro === null) return null;
      return aplicarComparacao(
        condicao.operador,
        deslocar(campo, condicao.ajuste),
        deslocar(outro, condicao.ajuste_outro)
      );
    }

    case "numero_da_linha": {
      const campo = lerFaixa(condicao.alvo, condicao.posicao, ctx);
      if (campo === null) return null;
      let numero: number;
      try {
        numero = indiceDe(condicao.fluxo, ctx);
      } catch (erro) {
        if (erro instanceof ExpressaoNaoSuportada) return null;
        throw erro;
      }
      // O fonte compara texto com número, e o `==` do JavaScript coage a faixa:
      // `"000006"` passa como 6.
      return aplicarComparacao(condicao.operador, campo, numero);
    }

    case "tamanho_linha": {
      const indice = resolverIndice(condicao.alvo, ctx);
      if (indice === null) return null;
      return aplicarComparacao(
        condicao.operador,
        linhaDe(ctx, indice).length,
        condicao.tamanho
      );
    }

    case "modulo_11":
      return avaliarModulo11(condicao, ctx);

    case "disjuncao": {
      const partes = condicao.partes.map((parte) => avaliarCondicao(parte, ctx));
      if (partes.some((p) => p === null)) return null;
      return partes.some(Boolean);
    }

    case "conjuncao": {
      const partes = condicao.partes.map((parte) => avaliarCondicao(parte, ctx));
      if (partes.some((p) => p === null)) return null;
      return partes.every(Boolean);
    }

    case "custom":
      return null;
  }
}

/**
 * Resto da soma ponderada, que é a primeira metade do cálculo do dígito. O fonte
 * também o compara direto, sem virar dígito, para escolher qual regra aplicar.
 */
export function calcularResto(
  calculo: {
    base: Extract<DslCondition, { tipo: "modulo_11" }>["base"];
    modulo: number;
    /** Redução por excesso do módulo 10; ausente é a soma ponderada direta. */
    dobra?: { limite: number; subtrai: number } | null;
  },
  ctx: ContextoArquivo
): number | null {
  // A função que o fonte aplica a cada parcela do CNPJ alfanumérico não está no
  // spec — sem ela, calcular seria inventar um resultado.
  if (calculo.base.some((parcela) => parcela.transformacao !== null)) return null;

  const dobra = calculo.dobra ?? null;
  let soma = 0;
  for (const parcela of calculo.base) {
    const campo = lerFaixa(parcela.alvo, parcela, ctx);
    if (campo === null) return null;
    const produto = Number(campo) * parcela.peso;
    // O fonte reduz parcela a parcela, antes de somar: reduzir o total daria
    // outro número. É o `if (faixa * 2 > 9) soma = (faixa * 2) - 9` do módulo 10.
    soma += dobra && produto > dobra.limite ? produto - dobra.subtrai : produto;
  }
  if (isNaN(soma)) return null;

  return soma % calculo.modulo;
}

/**
 * O dígito que o fonte calcula: soma ponderada, resto da divisão, e o valor
 * esperado por faixa de resto. Vale tanto para a condição da regra quanto para a
 * variável que a guarda referencia — é o mesmo cálculo, escrito duas vezes no
 * fonte porque ele repete o bloco por dígito informado.
 */
export function calcularDigito(
  calculo: {
    base: Extract<DslCondition, { tipo: "modulo_11" }>["base"];
    modulo: number;
    dobra?: { limite: number; subtrai: number } | null;
    resultado: Extract<DslCondition, { tipo: "modulo_11" }>["resultado"];
  },
  ctx: ContextoArquivo
): Valor | null {
  const resto = calcularResto(calculo, ctx);
  if (resto === null) return null;

  // A ordem do fonte é a ordem de avaliação: a última atribuição que casa vence.
  let esperado: Valor | null = null;
  for (const faixa of calculo.resultado) {
    const casa =
      faixa.operador === null || faixa.resto === null
        ? true
        : aplicarComparacao(faixa.operador, resto, faixa.resto);
    if (!casa) continue;

    if (faixa.valor !== null) {
      esperado = faixa.valor;
      continue;
    }
    try {
      esperado = avaliarValor(faixa.expressao, { ...ctx, variaveis: { resto } });
    } catch (erro) {
      if (erro instanceof ExpressaoNaoSuportada) return null;
      throw erro;
    }
  }
  return esperado;
}

function avaliarModulo11(
  condicao: Extract<DslCondition, { tipo: "modulo_11" }>,
  ctx: ContextoArquivo
): boolean | null {
  if (condicao.transformacao !== null) return null;

  const esperado = calcularDigito(condicao, ctx);
  if (esperado === null) return null;

  const digito = lerFaixa(condicao.alvo, condicao.posicao, ctx);
  if (digito === null) return null;
  // O fonte compara sem aspas contra número e com aspas contra letra; `==` cobre
  // os dois casos com a mesma coerção que ele usa.
  return !aplicarComparacao("==", digito, esperado);
}

/** Avalia uma expressão que devolve valor (não booleano), como `11 - resto`. */
function avaliarValor(fonte: string, ctx: ContextoArquivo): Valor {
  const limpo = fonte.trim();
  const literal = limpo.match(/^(?:"([^"]*)"|'([^']*)'|(-?\d+))$/);
  if (literal) return literal[1] ?? literal[2] ?? Number(literal[3]);

  const subtracao = limpo.match(/^(\d+)\s*-\s*([A-Za-z_$][\w$]*)$/);
  if (subtracao) {
    const variavel = ctx.variaveis?.[subtracao[2]];
    if (typeof variavel !== "number") {
      throw new ExpressaoNaoSuportada(`variável não resolvida: ${subtracao[2]}`);
    }
    return Number(subtracao[1]) - variavel;
  }

  // `avaliarExpressao` devolve booleano; aqui o que se quer é o valor.
  throw new ExpressaoNaoSuportada(`expressão de valor não suportada: ${limpo}`);
}

/**
 * Aplica o deslocamento do fonte a uma faixa. Sem deslocamento a faixa segue
 * string, e a comparação é textual; com deslocamento o `-` do JavaScript já
 * converteu para número antes do operador ver os dois lados — inclusive quando a
 * conversão dá `NaN`, que é como o fonte reprova faixa não numérica.
 */
function deslocar(campo: string, ajuste: number | null): Valor {
  return ajuste === null ? campo : Number(campo) + ajuste;
}

function comparar(
  operador: string,
  campo: string,
  valor: string,
  comparacao: "estrita" | "frouxa"
): boolean {
  // Comparação frouxa é a do fonte contra literal sem aspas: o JavaScript converte
  // a string lida para número antes de comparar, e é isso que faz `" 1"` passar
  // como `01` e o campo em branco valer zero.
  const direita: Valor = comparacao === "frouxa" ? Number(valor) : valor;
  return aplicarComparacao(operador, campo, direita);
}

function lerFaixa(
  alvo: string,
  posicao: { inicio0: number; fim0: number },
  ctx: ContextoArquivo
): string | null {
  const indice = resolverIndice(alvo, ctx);
  if (indice === null) return null;
  return linhaDe(ctx, indice).substring(posicao.inicio0, posicao.fim0);
}

/** `res[i]`, `res[0]`, `res[i + 2]`, `res[j]` — o índice pode ser aritmético. */
export function resolverIndice(alvo: string, ctx: ContextoArquivo): number | null {
  const dentro = alvo.match(/^res\[(.+)\]$/);
  if (!dentro) return null;
  try {
    return indiceDe(dentro[1], ctx);
  } catch (erro) {
    if (erro instanceof ExpressaoNaoSuportada) return null;
    throw erro;
  }
}

function indiceDe(expressao: string, ctx: ContextoArquivo): number {
  const limpo = expressao.trim();
  const numero = limpo.match(/^\d+$/);
  if (numero) return Number(limpo);

  const aritmetica = limpo.match(/^([A-Za-z_$][\w$]*)\s*([+-])\s*(\d+)$/);
  if (aritmetica) {
    const base = variavelDeIndice(aritmetica[1], ctx);
    const passo = Number(aritmetica[3]);
    return aritmetica[2] === "+" ? base + passo : base - passo;
  }

  const nome = limpo.match(/^[A-Za-z_$][\w$]*$/);
  if (nome) return variavelDeIndice(limpo, ctx);

  throw new ExpressaoNaoSuportada(`índice não suportado: ${limpo}`);
}

function variavelDeIndice(nome: string, ctx: ContextoArquivo): number {
  if (nome === "i") return ctx.i;
  // `j = i + 1` no fonte.
  if (nome === "j") return ctx.i + 1;
  const variavel = ctx.variaveis?.[nome];
  if (typeof variavel === "number") return variavel;
  throw new ExpressaoNaoSuportada(`índice desconhecido: ${nome}`);
}

export { avaliarExpressao };
