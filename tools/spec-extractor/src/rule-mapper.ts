import type { RawRule } from "./ast-walker.js";

export interface DslCondition {
  tipo: string;
  alvo?: string;
  posicao?: { inicio0: number; fim0: number };
  operador?: string;
  valor?: string;
  valores?: string[];
  documento?: string;
  outro?: string;
}

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
  // Dominio: cadeia de != contra valores literais (deve vir antes do literal fixo)
  const dominioMatches = [...condicaoOriginal.matchAll(/"([^"]+)"/g)];
  if (dominioMatches.length >= 2 && condicaoOriginal.includes("&&")) {
    const m = condicaoOriginal.match(/substring\((\d+),\s*(\d+)\)/);
    if (m) {
      return {
        tipo: "dominio",
        alvo,
        posicao: { inicio0: parseInt(m[1], 10), fim0: parseInt(m[2], 10) },
        valores: dominioMatches.map((x) => x[1]),
      };
    }
  }

  // Literal fixo: res[x].substring(a,b) != "valor"
  const literalMatch = condicaoOriginal.match(
    /(\w+)\[(\w+)\]\.substring\((\d+),\s*(\d+)\)\s*(!=|==)\s*"([^"]*)"/
  );
  if (literalMatch) {
    const [, , index, a, b, operador, valor] = literalMatch;
    return {
      tipo: "literal_fixo",
      alvo: `res[${index}]`,
      posicao: { inicio0: parseInt(a, 10), fim0: parseInt(b, 10) },
      operador,
      valor,
    };
  }

  // Numerico/branco: isNaN(...) || ...replace(/\s/g,'').length != 0
  if (condicaoOriginal.includes("isNaN")) {
    const m = condicaoOriginal.match(/substring\((\d+),\s*(\d+)\)/);
    if (m) {
      return {
        tipo: "numerico_branco",
        alvo,
        posicao: { inicio0: parseInt(m[1], 10), fim0: parseInt(m[2], 10) },
      };
    }
  }

  // Modulo 11: substring(...) != calcularModulo11(...)
  if (
    condicaoOriginal.includes("calcularModulo11") ||
    condicaoOriginal.includes("modulo11")
  ) {
    const m = condicaoOriginal.match(/substring\((\d+),\s*(\d+)\)/);
    if (m) {
      return {
        tipo: "modulo_11",
        alvo,
        posicao: { inicio0: parseInt(m[1], 10), fim0: parseInt(m[2], 10) },
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

function inferirDocumento(condicao: string): string {
  if (condicao.includes("CNPJ")) return "cnpj";
  if (condicao.includes("CPF")) return "cpf";
  if (condicao.includes("agencia")) return "agencia";
  if (condicao.includes("conta")) return "conta";
  return "desconhecido";
}
