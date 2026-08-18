import type { RawRule } from "./ast-walker.js";

export type DslCondition =
  | {
      tipo: "literal_fixo";
      alvo: string;
      posicao: { inicio0: number; fim0: number };
      operador: string;
      valor: string;
    }
  | { tipo: "numerico_branco"; alvo: string; posicao: { inicio0: number; fim0: number } }
  | { tipo: "dominio"; alvo: string; posicao: { inicio0: number; fim0: number }; valores: string[] }
  | { tipo: "modulo_11"; alvo: string; posicao: { inicio0: number; fim0: number }; documento: string }
  | { tipo: "coerencia_registro"; alvo: string; outro: string }
  | { tipo: "custom"; alvo: string };

export interface DslRule {
  id: string;
  funcao_origem: string;
  linha_fonte: number;
  registro: string;
  registro_alvo: string[];
  colunas: [number, number];
  posicoes: {
    alvo: string;
    inicio0: number;
    fim0: number;
    colunas: [number, number];
    tamanho: number;
  }[];
  condicao: DslCondition;
  condicao_original: string;
  descricao: string;
  mensagem: string;
  natureza: string;
  severidade: string;
}

export function mapToDsl(raw: RawRule, layout: string): DslRule {
  const alvo = raw.alvo ?? "res[0]";
  const condicao = inferirCondicao(raw.condicao_original, alvo);
  const colunas = raw.colunas ?? [0, 0];
  const inicio0 = colunas[0] > 0 ? colunas[0] - 1 : 0;
  const fim0 = colunas[1] > 0 ? colunas[1] : inicio0 + 1;

  return {
    id: `${layout}:${raw.linha_fonte}`,
    funcao_origem: raw.funcao_origem,
    linha_fonte: raw.linha_fonte,
    registro: raw.registro ?? "nao-classificado",
    registro_alvo: [alvo],
    colunas,
    posicoes: [
      {
        alvo,
        inicio0,
        fim0,
        colunas,
        tamanho: fim0 - inicio0,
      },
    ],
    condicao,
    condicao_original: raw.condicao_original,
    descricao: raw.mensagem.replace(/<br>/g, "").trim(),
    mensagem: raw.mensagem.replace(/<br>/g, "").trim(),
    natureza: "validacao-estrutural",
    severidade: "erro",
  };
}

function inferirCondicao(condicaoOriginal: string, alvo: string): DslCondition {
  const condicao = stripOuterParens(condicaoOriginal);

  // Dominio: cadeia de alvo.substring(a,b) != "valor" conectadas por &&
  const dominio = inferirDominio(condicao);
  if (dominio) return dominio;

  // Literal fixo: res[x].substring(a,b) != "valor"
  const literalMatch = condicao.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(===|!==|==|!=)\s*"([^"]*)"$/
  );
  if (literalMatch) {
    const [, target, a, b, operador, valor] = literalMatch;
    return {
      tipo: "literal_fixo",
      alvo: target,
      posicao: { inicio0: parseInt(a, 10), fim0: parseInt(b, 10) },
      operador,
      valor,
    };
  }

  // Numerico/branco: isNaN(alvo.substring(...)) || alvo.substring(...).replace(/\s/g,'').length != 0
  const numericoMatch = condicao.match(
    /^isNaN\((res\[[^\]]+\]\.substring\((\d+),\s*(\d+)\))\)\s*\|\|\s*\1\.replace\(\/\\s\/g,\s*''\)\.length\s*!=\s*0$/
  );
  if (numericoMatch) {
    const [, target, a, b] = numericoMatch;
    return {
      tipo: "numerico_branco",
      alvo: target,
      posicao: { inicio0: parseInt(a, 10), fim0: parseInt(b, 10) },
    };
  }

  // Modulo 11: alvo.substring(...) != calcularModulo11(alvo.substring(...))
  const moduloMatch = condicao.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*!=\s*calcularModulo11\(\1\.substring\((\d+),\s*(\d+)\)\)$/
  );
  if (moduloMatch) {
    const [, target, a1, b1, a2, b2] = moduloMatch;
    if (a1 === a2 && b1 === b2) {
      return {
        tipo: "modulo_11",
        alvo: target,
        posicao: { inicio0: parseInt(a1, 10), fim0: parseInt(b1, 10) },
        documento: inferirDocumento(condicao),
      };
    }
  }

  // Coerencia entre registros: res[i]... != res[i+1]...
  if (
    condicao.includes("res[i + 1]") ||
    condicao.includes("res[i+1]")
  ) {
    return {
      tipo: "coerencia_registro",
      alvo,
      outro: "res[i+1]",
    };
  }

  return { tipo: "custom", alvo };
}

function inferirDominio(condicao: string): DslCondition | null {
  const clauses = splitLogicalAndClauses(condicao);
  if (clauses.length < 2) return null;

  const clauseRegex =
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(!==|!=)\s*"([^"]+)"$/;
  const matches = clauses.map((c) => c.match(clauseRegex));
  if (matches.some((m) => m === null)) return null;

  const validMatches = matches as RegExpMatchArray[];
  const first = validMatches[0];
  const target = first[1];
  const inicio0 = parseInt(first[2], 10);
  const fim0 = parseInt(first[3], 10);

  const sameTargetAndPosition = validMatches.every(
    (m) =>
      m[1] === target &&
      parseInt(m[2], 10) === inicio0 &&
      parseInt(m[3], 10) === fim0
  );
  if (!sameTargetAndPosition) return null;

  return {
    tipo: "dominio",
    alvo: target,
    posicao: { inicio0, fim0 },
    valores: validMatches.map((m) => m[5]),
  };
}

function splitLogicalAndClauses(expr: string): string[] {
  const base = stripOuterParens(expr);

  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < base.length; i++) {
    const char = base[i];
    const prev = base[i - 1];

    if (inQuote) {
      current += char;
      if (char === quoteChar && prev !== "\\") inQuote = false;
      continue;
    }

    if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
      current += char;
      continue;
    }

    if (char === "(") {
      depth++;
      current += char;
      continue;
    }

    if (char === ")") {
      depth--;
      current += char;
      continue;
    }

    if (char === "&" && base[i + 1] === "&" && depth === 0) {
      parts.push(stripOuterParens(current.trim()));
      current = "";
      i++;
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(stripOuterParens(current.trim()));
  return parts;
}

function stripOuterParens(s: string): string {
  let trimmed = s.trim();
  let stripped: string;
  while ((stripped = stripBalancedParens(trimmed)) !== trimmed) {
    trimmed = stripped;
  }
  return trimmed;
}

function stripBalancedParens(s: string): string {
  if (!s.startsWith("(") || !s.endsWith(")")) return s;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0 && i < s.length - 1) return s;
    }
  }
  return s.slice(1, -1).trim();
}

function inferirDocumento(condicao: string): string {
  if (condicao.includes("CNPJ")) return "cnpj";
  if (condicao.includes("CPF")) return "cpf";
  if (condicao.includes("agencia")) return "agencia";
  if (condicao.includes("conta")) return "conta";
  return "desconhecido";
}
