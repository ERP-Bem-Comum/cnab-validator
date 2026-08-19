import type { RawRule } from "./ast-walker.js";

export interface Logger {
  warn: (message: string) => void;
}

const noopLogger: Logger = { warn: () => {} };

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
  | {
      tipo: "coerencia_registro";
      alvo: string;
      posicao: { inicio0: number; fim0: number };
      operador: string;
      outro: string;
      posicao_outro: { inicio0: number; fim0: number };
    }
  | { tipo: "tamanho_linha"; alvo: string; operador: string; tamanho: number }
  | { tipo: "custom"; alvo: string };

export interface DslRule {
  id: string;
  funcao_origem: string;
  linha_fonte: number;
  registro: string;
  /** Segundo registro citado na mensagem — alvo da comparação em regras de coerência. */
  registro_referenciado: string | null;
  /** "guarda" quando o tipo veio da estrutura do fonte, "mensagem" quando veio do texto. */
  registro_origem: "guarda" | "mensagem" | null;
  registro_alvo: string[];
  /** Faixa efetivamente lida pela condição — é o que um motor de validação deve usar. */
  colunas: [number, number];
  /**
   * Faixa que a mensagem declara, quando difere de `colunas`. O fonte costuma
   * reportar o campo inteiro (ex.: o CNPJ) enquanto testa só uma parte dele
   * (ex.: o dígito verificador); as duas informações são distintas e ambas úteis.
   */
  colunas_mensagem: [number, number] | null;
  posicoes: {
    alvo: string;
    inicio0: number;
    fim0: number;
    colunas: [number, number];
    tamanho: number;
  }[];
  condicao: DslCondition;
  condicao_original: string;
  /** Guardas dos `if` externos; null quando a regra está no nível raiz da função. */
  condicao_guarda: string | null;
  descricao: string;
  mensagem: string;
  natureza: string;
  severidade: string;
}

export function extrairPosicoesDaCondicao(
  condicao: string,
  alvo: string = "res[0]"
): { inicio0: number; fim0: number } | null {
  // Tenta extrair a posição da substring do alvo específico (ex: res[0].substring(a,b))
  // para evitar usar o primeiro .substring() da condição quando há múltiplos res[...].
  const escaped = alvo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const specific = new RegExp(`${escaped}\\.substring\\((\\d+),\\s*(\\d+)\\)`);
  const specificMatch = condicao.match(specific);
  if (specificMatch) {
    return {
      inicio0: parseInt(specificMatch[1], 10),
      fim0: parseInt(specificMatch[2], 10),
    };
  }

  // Fallback: primeiro .substring() encontrado. Pode ser impreciso quando a
  // condição referencia mais de um res[...]; nesses casos o consumidor deve
  // tratar as colunas com cautela.
  const fallback = condicao.match(/\.substring\((\d+),\s*(\d+)\)/);
  if (!fallback) return null;
  return { inicio0: parseInt(fallback[1], 10), fim0: parseInt(fallback[2], 10) };
}

export function mapToDsl(
  raw: RawRule,
  layout: string,
  logger: Logger = noopLogger
): DslRule {
  const alvo = raw.alvo ?? "res[0]";

  // A condição própria é o teste do `if` que emite a mensagem. Classificar e posicionar
  // pela conjunção completa faria a guarda mais externa ditar as colunas da regra.
  const condicaoPropria = raw.condicao_propria ?? raw.condicao_original;
  const condicao = inferirCondicao(condicaoPropria, alvo, raw.condicao_original);

  let colunas: [number, number];
  let inicio0: number;
  let fim0: number;

  const posicoesCondicao = extrairPosicoesDaCondicao(condicaoPropria, alvo);
  // Sem faixa na condição e sem faixa na mensagem, a regra não é sobre uma posição
  // (comprimento da linha, coerência entre linhas). Publicar uma posição inventada
  // faria um motor de validação ler a coluna errada.
  const semPosicao = !posicoesCondicao && !raw.colunas;
  if (posicoesCondicao) {
    inicio0 = posicoesCondicao.inicio0;
    fim0 = posicoesCondicao.fim0;

    if (fim0 < inicio0) {
      logger.warn(
        `[${layout}:${raw.funcao_origem}:${raw.linha_fonte}] Posições invertidas na condição: ${condicaoPropria}`
      );
      const temp = inicio0;
      inicio0 = fim0;
      fim0 = temp;
    }

    colunas = [inicio0 + 1, fim0];
  } else {
    colunas = raw.colunas ?? [0, 0];
    inicio0 = colunas[0] > 0 ? colunas[0] - 1 : 0;
    fim0 = colunas[1] > 0 ? colunas[1] : inicio0 + 1;

    if (fim0 < inicio0) {
      logger.warn(
        `[${layout}:${raw.funcao_origem}:${raw.linha_fonte}] Colunas invertidas: [${colunas[0]}, ${colunas[1]}]`
      );
      const temp = inicio0;
      inicio0 = fim0;
      fim0 = temp;
    }
  }

  return {
    id: `${layout}:${raw.funcao_origem}:${raw.linha_fonte}`,
    funcao_origem: raw.funcao_origem,
    linha_fonte: raw.linha_fonte,
    registro: raw.registro ?? "nao-classificado",
    registro_referenciado: raw.registro_referenciado ?? null,
    registro_origem: raw.registro_origem ?? null,
    registro_alvo: [alvo],
    colunas,
    colunas_mensagem:
      raw.colunas && (raw.colunas[0] !== colunas[0] || raw.colunas[1] !== colunas[1])
        ? raw.colunas
        : null,
    posicoes: semPosicao
      ? []
      : [
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
    condicao_guarda: raw.condicao_guarda ?? null,
    descricao: raw.mensagem.replace(/<br>/g, "").trim(),
    mensagem: raw.mensagem.replace(/<br>/g, "").trim(),
    natureza: "validacao-estrutural",
    severidade: "erro",
  };
}

function inferirCondicao(
  condicaoPropria: string,
  alvo: string,
  condicaoCompleta: string = condicaoPropria
): DslCondition {
  // Fusão de cadeia: o fonte expressa domínio negado encadeando `if` aninhados sobre
  // a mesma posição, um valor por nível, com uma única mensagem no nível mais interno.
  // Só funde quando *toda* a conjunção — guardas inclusive — testa a mesma posição do
  // mesmo alvo, o que descarta guardas heterogêneas.
  const cadeia = inferirDominio(stripOuterParens(condicaoCompleta));
  if (cadeia) return cadeia;

  const condicao = stripOuterParens(condicaoPropria);

  // Dominio: cadeia de alvo.substring(a,b) != "valor" conectadas por && no mesmo `if`
  const dominio = inferirDominio(condicao);
  if (dominio) return dominio;

  // Literal fixo: res[x].substring(a,b) (==|!=) "valor" ou número
  const literalMatch = condicao.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(===|!==|==|!=)\s*(?:"([^"]*)"|(\d+))$/
  );
  if (literalMatch) {
    const [, target, a, b, operador, valorStr, valorNum] = literalMatch;
    return {
      tipo: "literal_fixo",
      alvo: target,
      posicao: { inicio0: parseInt(a, 10), fim0: parseInt(b, 10) },
      operador,
      valor: valorStr ?? valorNum,
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
  // Nota: as fontes do ciclo atual não usam essas funções (o dígito é validado
  // com expressões aritméticas inline), mas o matcher reconhece as variações
  // mais comuns para quando/uso futuro.
  const MODULO_11_FUNCOES =
    "(?:calcularModulo11|modulo11|calcModulo11|mod11|calcularDigitoVerificador|calcularDigito|calcularDV|calcDV)";
  const moduloMatch = condicao.match(
    new RegExp(
      `^(res\\[[^\\]]+\\])\\.substring\\((\\d+),\\s*(\\d+)\\)\\s*!=\\s*${MODULO_11_FUNCOES}\\(\\1\\.substring\\((\\d+),\\s*(\\d+)\\)\\)$`
    )
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

  // Coerência entre registros: compara a mesma leitura em duas linhas distintas
  // (res[i] contra res[j] ou contra res[i + 1]). É o arquétipo que sustenta regras
  // como "banco único por lote".
  const coerencia = condicao.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(===|!==|==|!=)\s*(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)$/
  );
  if (coerencia) {
    const [, alvoA, a1, b1, operador, alvoB, a2, b2] = coerencia;
    if (alvoA !== alvoB) {
      return {
        tipo: "coerencia_registro",
        alvo: alvoA,
        posicao: { inicio0: parseInt(a1, 10), fim0: parseInt(b1, 10) },
        operador,
        outro: alvoB,
        posicao_outro: { inicio0: parseInt(a2, 10), fim0: parseInt(b2, 10) },
      };
    }
  }

  // Tamanho da linha: `res[x].length != 240`, eventualmente acompanhado de uma
  // guarda de índice (`i > 0 && res[i].length != 400`). Não lê faixa de colunas —
  // valida o registro inteiro —, por isso é arquétipo próprio e não regra sem posição.
  const tamanhoLinha = inferirTamanhoLinha(condicao);
  if (tamanhoLinha) return tamanhoLinha;

  return { tipo: "custom", alvo };
}

function inferirTamanhoLinha(condicao: string): DslCondition | null {
  const clauses = splitLogicalAndClauses(condicao);
  const regex = /^(res\[[^\]]+\])\.length\s*(===|!==|==|!=|<=|>=|<|>)\s*(\d+)$/;

  const casadas = clauses.map((c) => c.match(regex)).filter((m) => m !== null);
  if (casadas.length !== 1) return null;
  // Se alguma outra cláusula lê uma faixa, a regra não é apenas sobre o comprimento.
  if (clauses.some((c) => c.includes(".substring("))) return null;

  const [, alvo, operador, tamanho] = casadas[0] as RegExpMatchArray;
  return {
    tipo: "tamanho_linha",
    alvo,
    operador,
    tamanho: parseInt(tamanho, 10),
  };
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
