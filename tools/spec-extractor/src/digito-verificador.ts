import type { DslCondition, DslRule } from "./rule-mapper.js";

/**
 * Cálculo do dígito verificador de agência e de conta, **derivado do spec**.
 *
 * Existe para ser usado de fora sobre um par agência/conta, sem gerar arquivo:
 * é assim que um cadastro pode ser auditado. Nada aqui é escrito à mão — pesos,
 * módulo, tratamento de resto e a fronteira de banco saem das regras extraídas do
 * validador oficial. Se o banco mudar o algoritmo, o spec muda e esta função muda
 * junto; uma reimplementação manual divergiria em silêncio.
 */

export type Documento = "agencia" | "conta";

export interface ParametrosDigito {
  documento: Documento;
  /** Pesos aplicados aos últimos dígitos do valor, na ordem do fonte. */
  pesos: number[];
  modulo: number;
  /** Faixa do dígito no registro, 1-based — para rastrear de volta ao layout. */
  colunas_digito: [number, number];
  /**
   * Código do banco do favorecido que liga a verificação. Fora dele, o validador
   * **não** verifica o dígito na remessa: quem julga é a ocorrência de retorno.
   */
  banco_aplicavel: string;
  /** O fonte rejeita o caractere alternativo em caixa baixa nesta posição. */
  rejeita_caixa_baixa: boolean;
}

export interface Veredito {
  documento: Documento;
  valor: string;
  digito_informado: string;
  /** Todos os dígitos que o validador aceita para este valor. */
  aceitos: string[];
  valido: boolean;
  motivo: "confere" | "digito_incorreto" | "caixa_baixa" | "valor_nao_numerico";
}

const REGEX_BANCO_DA_GUARDA = /substring\(20,\s*23\)\s*==\s*"?(\d+)"?/;

/**
 * Lê os parâmetros do spec. Cada documento tem mais de uma regra — o fonte repete
 * o bloco de cálculo por valor informado no dígito —, e é a união dos ramos que dá
 * o conjunto aceito: no resto 1, um ramo espera `0` e o outro o caractere
 * alternativo, o que significa que o validador aceita os dois.
 */
export function parametrosDoSpec(
  regras: DslRule[],
  registro = "segmento-a"
): Record<Documento, ParametrosDigito> {
  const parametros = {} as Record<Documento, ParametrosDigito>;

  for (const documento of ["agencia", "conta"] as const) {
    const doDocumento = regras.filter(
      (r) =>
        r.registro === registro &&
        r.condicao.tipo === "modulo_11" &&
        r.condicao.documento === documento
    );
    if (doDocumento.length === 0) {
      throw new Error(`Spec não tem regra de módulo 11 para ${documento} em ${registro}`);
    }

    const referencia = doDocumento[0].condicao as Extract<
      DslCondition,
      { tipo: "modulo_11" }
    >;
    const banco = doDocumento
      .map((r) => r.condicao_guarda?.match(REGEX_BANCO_DA_GUARDA)?.[1])
      .find((b): b is string => Boolean(b));
    if (!banco) {
      throw new Error(
        `Regra de ${documento} sem banco na guarda: a fronteira do cálculo se perderia`
      );
    }

    parametros[documento] = {
      documento,
      pesos: referencia.base.map((parcela) => parcela.peso),
      modulo: referencia.modulo,
      colunas_digito: doDocumento[0].colunas,
      banco_aplicavel: banco,
      rejeita_caixa_baixa: temRegraDeCaixaBaixa(regras, registro, doDocumento[0].colunas),
    };
  }

  return parametros;
}

function temRegraDeCaixaBaixa(
  regras: DslRule[],
  registro: string,
  colunas: [number, number]
): boolean {
  return regras.some(
    (r) =>
      r.registro === registro &&
      r.condicao.tipo === "intervalo" &&
      r.colunas[0] === colunas[0] &&
      r.colunas[1] === colunas[1] &&
      r.condicao.limites.some((l) => l.valor === "a") &&
      r.condicao.limites.some((l) => l.valor === "z")
  );
}

/** Dígitos que o validador aceita para o valor, na ordem em que o fonte os produz. */
export function digitosAceitos(valor: string, regras: DslRule[], documento: Documento): string[] {
  const parametros = parametrosDoSpec(regras)[documento];
  const resto = restoDe(valor, parametros);
  if (resto === null) return [];

  const aceitos: string[] = [];
  for (const regra of regras) {
    if (regra.condicao.tipo !== "modulo_11") continue;
    if (regra.condicao.documento !== documento) continue;
    const esperado = digitoEsperado(regra.condicao, resto);
    if (esperado !== null && !aceitos.includes(esperado)) aceitos.push(esperado);
  }
  return aceitos;
}

/** Resto da soma ponderada. `null` quando o valor não é numérico. */
export function restoDe(valor: string, parametros: ParametrosDigito): number | null {
  const digitos = valor.slice(-parametros.pesos.length);
  if (digitos.length < parametros.pesos.length) return null;

  let soma = 0;
  for (let i = 0; i < parametros.pesos.length; i++) {
    const digito = Number(digitos[i]);
    if (!Number.isInteger(digito)) return null;
    soma += digito * parametros.pesos[i];
  }
  return soma % parametros.modulo;
}

/** Percorre os ramos na ordem do fonte: a última atribuição que casa é a que vale. */
function digitoEsperado(
  condicao: Extract<DslCondition, { tipo: "modulo_11" }>,
  resto: number
): string | null {
  let esperado: string | null = null;

  for (const faixa of condicao.resultado) {
    const casa =
      faixa.operador === null || faixa.resto === null
        ? true
        : compararResto(faixa.operador, resto, faixa.resto);
    if (!casa) continue;

    if (faixa.valor !== null) {
      esperado = faixa.valor;
      continue;
    }
    const subtracao = faixa.expressao.match(/^(\d+)\s*-\s*resto$/);
    esperado = subtracao ? String(Number(subtracao[1]) - resto) : null;
  }

  return esperado;
}

function compararResto(operador: string, resto: number, referencia: number): boolean {
  switch (operador) {
    case "==":
    case "===":
      return resto === referencia;
    case "!=":
    case "!==":
      return resto !== referencia;
    case ">":
      return resto > referencia;
    case ">=":
      return resto >= referencia;
    case "<":
      return resto < referencia;
    case "<=":
      return resto <= referencia;
    default:
      return false;
  }
}

export function verificarDigito(
  valor: string,
  digitoInformado: string,
  regras: DslRule[],
  documento: Documento
): Veredito {
  const parametros = parametrosDoSpec(regras)[documento];
  const base = { documento, valor, digito_informado: digitoInformado };

  if (restoDe(valor, parametros) === null) {
    return { ...base, aceitos: [], valido: false, motivo: "valor_nao_numerico" };
  }

  const aceitos = digitosAceitos(valor, regras, documento);

  if (parametros.rejeita_caixa_baixa && /^[a-z]$/.test(digitoInformado)) {
    return { ...base, aceitos, valido: false, motivo: "caixa_baixa" };
  }

  const valido = aceitos.includes(digitoInformado);
  return { ...base, aceitos, valido, motivo: valido ? "confere" : "digito_incorreto" };
}

export interface ParFavorecido {
  /** Código do banco do favorecido. Fora do banco aplicável, nada é verificado. */
  banco: string;
  agencia: string;
  digito_agencia: string;
  conta: string;
  digito_conta: string;
}

export interface VereditoDoPar {
  /**
   * `false` quando o favorecido é de outra instituição: o validador **não**
   * verifica o dígito na remessa nesse caso, e afirmar erro aqui seria inventar
   * uma regra que o banco não aplica.
   */
  aplicavel: boolean;
  agencia?: Veredito;
  conta?: Veredito;
  valido: boolean;
}

export function verificarPar(par: ParFavorecido, regras: DslRule[]): VereditoDoPar {
  const parametros = parametrosDoSpec(regras);
  const aplicavel =
    Number(par.banco) === Number(parametros.agencia.banco_aplicavel);
  if (!aplicavel) return { aplicavel: false, valido: true };

  const agencia = verificarDigito(par.agencia, par.digito_agencia, regras, "agencia");
  const conta = verificarDigito(par.conta, par.digito_conta, regras, "conta");
  return { aplicavel: true, agencia, conta, valido: agencia.valido && conta.valido };
}
