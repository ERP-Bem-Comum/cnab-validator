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
  // Dominio: cadeia de alvo.substring(a,b) != "valor" conectadas por &&
  const dominio = inferirDominio(condicaoOriginal);
  if (dominio) return dominio;

  // Literal fixo: res[x].substring(a,b) != "valor"
  const literalMatch = condicaoOriginal.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(!=|==)\s*"([^"]*)"$/
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
  const numericoMatch = condicaoOriginal.match(
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
  const moduloMatch = condicaoOriginal.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*!=\s*calcularModulo11\(\1\.substring\((\d+),\s*(\d+)\)\)$/
  );
  if (moduloMatch) {
    const [, target, a1, b1, a2, b2] = moduloMatch;
    if (a1 === a2 && b1 === b2) {
      return {
        tipo: "modulo_11",
        alvo: target,
        posicao: { inicio0: parseInt(a1, 10), fim0: parseInt(b1, 10) },
        documento: inferirDocumento(condicaoOriginal),
      };
    }
  }

  // Coerencia entre registros: res[i]... != res[i+1]...
  if (
    condicaoOriginal.includes("res[i + 1]") ||
    condicaoOriginal.includes("res[i+1]")
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
  const clauseRegex =
    /(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*!=\s*"([^"]+)"/g;
  const matches = [...condicao.matchAll(clauseRegex)];

  if (matches.length < 2) return null;

  const reconstructed = matches.map((m) => m[0]).join(" && ");
  if (reconstructed !== condicao) return null;

  const first = matches[0];
  const target = first[1];
  const inicio0 = parseInt(first[2], 10);
  const fim0 = parseInt(first[3], 10);

  const sameTargetAndPosition = matches.every(
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
    valores: matches.map((m) => m[4]),
  };
}

function inferirDocumento(condicao: string): string {
  if (condicao.includes("CNPJ")) return "cnpj";
  if (condicao.includes("CPF")) return "cpf";
  if (condicao.includes("agencia")) return "agencia";
  if (condicao.includes("conta")) return "conta";
  return "desconhecido";
}
