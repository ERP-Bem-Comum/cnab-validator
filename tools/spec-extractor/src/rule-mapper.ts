import type { RawRule } from "./ast-walker.js";

export interface Logger {
  warn: (message: string) => void;
}

const noopLogger: Logger = { warn: () => {} };

/**
 * Modo de comparação do fonte. O validador oficial compara o resultado de
 * `substring()` — sempre string — ora contra literal entre aspas, ora contra
 * literal numérico. No segundo caso o JavaScript coage os tipos, e um campo em
 * branco passa a valer zero. Um motor que compare bytes não reproduz isso, então
 * o modo precisa viajar no spec.
 */
export type ModoComparacao = "estrita" | "frouxa";

/**
 * O que o fonte exige da faixa nas condições construídas com `isNaN(...) || ...`.
 * As três formas usam o mesmo `isNaN` e divergem só no teste residual, mas pedem
 * coisas opostas: uma exige conteúdo numérico, a outra exige branco.
 */
export type ExigenciaNumericoBranco =
  /** `replace(/\d/g,'').length == 1` — sobra um caractere não numérico. */
  | "numerico"
  /** `replace(/\s/g,'').length == 0` — nada sobra depois de tirar os espaços. */
  | "numerico_preenchido"
  /** `replace(/\s/g,'').length != 0` — sobra conteúdo onde deveria haver branco. */
  | "branco";

export type DslCondition =
  | {
      tipo: "literal_fixo";
      alvo: string;
      posicao: { inicio0: number; fim0: number };
      /** Operador já resolvido: `!(a == b)` vira `!=`. */
      operador: string;
      valor: string;
      comparacao: ModoComparacao;
    }
  | {
      tipo: "numerico_branco";
      alvo: string;
      posicao: { inicio0: number; fim0: number };
      exige: ExigenciaNumericoBranco;
      /** Teste residual literal do fonte, para reprodução byte a byte. */
      residuo: { padrao: string; operador: string; valor: number };
    }
  | {
      tipo: "dominio";
      alvo: string;
      posicao: { inicio0: number; fim0: number };
      valores: string[];
      /**
       * `permitidos`: conjunção de desigualdades — erro quando o campo não é
       * nenhum dos valores. `proibidos`: disjunção de igualdades — erro quando é
       * algum deles.
       */
      sentido: "permitidos" | "proibidos";
      comparacao: ModoComparacao;
    }
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
  /**
   * Disjunção do fonte: o validador encadeia com `||` vários testes sobre faixas
   * diferentes e emite uma única mensagem. Erro quando qualquer parte é verdadeira.
   * Só é publicada quando *todas* as partes têm arquétipo próprio — uma parte
   * `custom` derrubaria a regra inteira para `custom`, que é onde ela deve ficar.
   */
  | { tipo: "disjuncao"; alvo: string; partes: DslCondition[] }
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
  const condicao = inferirCondicao(
    condicaoPropria,
    alvo,
    raw.condicao_original,
    raw.condicao_guarda ?? null
  );

  let colunas: [number, number];
  let inicio0: number;
  let fim0: number;

  // Em disjunção cada parte lê a sua própria faixa: publicar só a primeira
  // esconderia metade do que a regra testa.
  const faixasDisjuncao =
    condicao.tipo === "disjuncao" ? faixasDaCondicao(condicao) : [];
  const posicoesCondicao = extrairPosicoesDaCondicao(condicaoPropria, alvo);
  // Sem faixa na condição e sem faixa na mensagem, a regra não é sobre uma posição
  // (comprimento da linha, coerência entre linhas). Publicar uma posição inventada
  // faria um motor de validação ler a coluna errada.
  const semPosicao = faixasDisjuncao.length === 0 && !posicoesCondicao && !raw.colunas;
  if (faixasDisjuncao.length > 0) {
    inicio0 = Math.min(...faixasDisjuncao.map((f) => f.inicio0));
    fim0 = Math.max(...faixasDisjuncao.map((f) => f.fim0));
    colunas = [inicio0 + 1, fim0];
  } else if (posicoesCondicao) {
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
      : faixasDisjuncao.length > 0
        ? faixasDisjuncao.map((f) => ({
            alvo: f.alvo,
            inicio0: f.inicio0,
            fim0: f.fim0,
            colunas: [f.inicio0 + 1, f.fim0] as [number, number],
            tamanho: f.fim0 - f.inicio0,
          }))
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

interface Faixa {
  alvo: string;
  inicio0: number;
  fim0: number;
}

/**
 * Faixas que a condição lê, em ordem de posição e sem repetição. Só as próprias:
 * a faixa do outro registro numa coerência já viaja em `posicao_outro`.
 */
function faixasDaCondicao(condicao: DslCondition): Faixa[] {
  const faixas: Faixa[] = [];

  const coletar = (c: DslCondition): void => {
    switch (c.tipo) {
      case "literal_fixo":
      case "numerico_branco":
      case "dominio":
      case "modulo_11":
      case "coerencia_registro":
        faixas.push({ alvo: c.alvo, inicio0: c.posicao.inicio0, fim0: c.posicao.fim0 });
        return;
      case "disjuncao":
        for (const parte of c.partes) coletar(parte);
        return;
      default:
        return;
    }
  };
  coletar(condicao);

  const vistas = new Set<string>();
  return faixas
    .filter((f) => {
      const chave = `${f.alvo}|${f.inicio0}|${f.fim0}`;
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    })
    .sort((a, b) => a.inicio0 - b.inicio0 || a.fim0 - b.fim0);
}

function inferirCondicao(
  condicaoPropria: string,
  alvo: string,
  condicaoCompleta: string = condicaoPropria,
  condicaoGuarda: string | null = null
): DslCondition {
  const simples = inferirCondicaoSimples(
    condicaoPropria,
    alvo,
    condicaoCompleta,
    condicaoGuarda
  );
  if (simples.tipo !== "custom") return simples;

  return inferirDisjuncao(stripOuterParens(condicaoPropria), alvo) ?? simples;
}

/**
 * Tenta reconhecer a condição como uma única disjunção de partes já modeladas.
 * Roda depois dos arquétipos que também são disjunções (`numerico_branco`,
 * `dominio` proibido), que descrevem melhor os casos que cobrem.
 */
function inferirDisjuncao(condicao: string, alvo: string): DslCondition | null {
  const partes = splitLogicalClauses(condicao, "||");
  if (partes.length < 2) return null;

  const modeladas: DslCondition[] = [];
  let i = 0;
  while (i < partes.length) {
    // `isNaN(faixa) || faixa.replace(...)` é um arquétipo só escrito em duas
    // cláusulas: sem juntar o par, cada metade isolada não significa nada.
    const par =
      i + 1 < partes.length
        ? inferirCondicaoSimples(`${partes[i]} || ${partes[i + 1]}`, alvo)
        : null;
    if (par && par.tipo !== "custom") {
      modeladas.push(par);
      i += 2;
      continue;
    }

    const isolada = inferirCondicaoSimples(partes[i], alvo);
    if (isolada.tipo === "custom") return null;
    modeladas.push(isolada);
    i += 1;
  }

  if (modeladas.length < 2) return null;
  return { tipo: "disjuncao", alvo, partes: modeladas };
}

function inferirCondicaoSimples(
  condicaoPropria: string,
  alvo: string,
  condicaoCompleta: string = condicaoPropria,
  condicaoGuarda: string | null = null
): DslCondition {
  const condicao = stripOuterParens(condicaoPropria);
  const posicaoPropria = extrairPosicoesDaCondicao(condicao, alvo);

  // Fusão de cadeia: o fonte expressa domínio negado encadeando `if` aninhados sobre
  // a mesma posição, um valor por nível, com uma única mensagem no nível mais interno.
  // A cadeia só existe na conjunção completa; as cláusulas que sobram precisam ser
  // guardas conhecidas, senão fundir perderia parte do teste.
  const cadeia = inferirDominioPermitidos(
    stripOuterParens(condicaoCompleta),
    clausulasDaGuarda(condicaoGuarda),
    posicaoPropria
  );
  if (cadeia) return cadeia;

  // Dominio: cadeia de alvo.substring(a,b) != "valor" conectadas por && no mesmo `if`
  const dominio = inferirDominioPermitidos(condicao, new Set(), posicaoPropria);
  if (dominio) return dominio;

  // Domínio proibido: o fonte também escreve o inverso — uma disjunção de igualdades
  // sobre a mesma posição, onde bater com qualquer valor da lista é o erro.
  const dominioProibido = inferirDominioProibidos(condicao);
  if (dominioProibido) return dominioProibido;

  // Literal fixo: res[x].substring(a,b) (==|!=) "valor" ou número
  const literal = parseComparacaoDePosicao(condicao);
  if (literal && literal.valor !== null) {
    return {
      tipo: "literal_fixo",
      alvo: literal.alvo,
      posicao: { inicio0: literal.inicio0, fim0: literal.fim0 },
      operador: literal.operador,
      valor: literal.valor,
      comparacao: literal.comparacao,
    };
  }

  // Numerico/branco: isNaN(faixa) || <teste residual sobre a mesma faixa>
  const numerico = inferirNumericoBranco(condicao);
  if (numerico) return numerico;

  // Modulo 11: alvo.substring(...) != calcularModulo11(alvo.substring(...))
  // Nota: as fontes do ciclo atual não usam essas funções (o dígito é comparado
  // com uma variável calculada antes do `if`), mas o matcher reconhece as
  // variações mais comuns para quando/uso futuro.
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
  const clauses = splitLogicalClauses(condicao, "&&");
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

/** Comparação de uma faixa contra um literal, já com as negações resolvidas. */
interface ComparacaoDePosicao {
  alvo: string;
  inicio0: number;
  fim0: number;
  /** `==` ou `!=` — a negação externa (`!(a == b)`) já foi aplicada. */
  operador: "==" | "!=";
  valor: string;
  comparacao: ModoComparacao;
}

function parseComparacaoDePosicao(clausula: string): ComparacaoDePosicao | null {
  let expr = stripOuterParens(clausula);
  let negada = false;

  // `!(...)`: o fonte nega a igualdade em vez de escrever a desigualdade.
  while (expr.startsWith("!") && !expr.startsWith("!=")) {
    const interno = expr.slice(1).trim();
    const semParens = stripOuterParens(interno);
    // `!x` sem parênteses não é comparação de faixa; deixa para outro matcher.
    if (semParens === interno) return null;
    expr = semParens;
    negada = !negada;
  }

  const m = expr.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(===|!==|==|!=)\s*(?:"([^"]*)"|'([^']*)'|(\d+))$/
  );
  if (!m) return null;

  const [, alvo, inicio, fim, operadorFonte, aspasDuplas, aspasSimples, numerico] = m;
  const estrito = operadorFonte === "===" || operadorFonte === "!==";
  const igualdade = operadorFonte === "==" || operadorFonte === "===";
  const comAspas = aspasDuplas !== undefined || aspasSimples !== undefined;

  return {
    alvo,
    inicio0: parseInt(inicio, 10),
    fim0: parseInt(fim, 10),
    operador: igualdade !== negada ? "==" : "!=",
    valor: aspasDuplas ?? aspasSimples ?? numerico,
    // `substring()` devolve string: só há coerção quando o literal é numérico e o
    // operador não é estrito.
    comparacao: !comAspas && !estrito ? "frouxa" : "estrita",
  };
}

function normalizarClausula(clausula: string): string {
  return stripOuterParens(clausula).replace(/\s+/g, " ").trim();
}

function clausulasDaGuarda(guarda: string | null): Set<string> {
  if (!guarda) return new Set();
  return new Set(splitLogicalClauses(guarda, "&&").map(normalizarClausula));
}

/**
 * Conjunção de desigualdades sobre a mesma faixa: o campo tem que ser um dos
 * valores listados. Cláusulas que não pertencem ao domínio só são toleradas
 * quando são guardas do `if` externo — elas continuam publicadas em
 * `condicao_guarda`, e nenhuma delas pode tocar a faixa do domínio.
 */
function inferirDominioPermitidos(
  condicao: string,
  guardas: Set<string>,
  posicaoPropria: { inicio0: number; fim0: number } | null
): DslCondition | null {
  // `a && b || c` é uma disjunção, não uma conjunção: dividir por && daria uma
  // leitura errada da expressão.
  if (splitLogicalClauses(condicao, "||").length > 1) return null;

  const clauses = splitLogicalClauses(condicao, "&&");
  if (clauses.length < 2) return null;

  const parsed = clauses.map((texto) => ({ texto, cmp: parseComparacaoDePosicao(texto) }));

  const grupos = new Map<string, typeof parsed>();
  for (const item of parsed) {
    if (!item.cmp || item.cmp.operador !== "!=") continue;
    const chave = `${item.cmp.alvo}|${item.cmp.inicio0}|${item.cmp.fim0}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), item]);
  }

  const candidatos = [...grupos.entries()].filter(([, itens]) => itens.length >= 2);
  if (candidatos.length === 0) return null;

  // Com mais de uma cadeia na mesma conjunção, só a que cobre a posição da condição
  // própria é a regra em questão; as outras pertencem a outra regra do fonte.
  const escolhido =
    candidatos.length === 1 && posicaoPropria === null
      ? candidatos[0]
      : candidatos.find(([, itens]) => {
          const cmp = itens[0].cmp as ComparacaoDePosicao;
          return (
            posicaoPropria !== null &&
            cmp.inicio0 === posicaoPropria.inicio0 &&
            cmp.fim0 === posicaoPropria.fim0
          );
        });
  if (!escolhido) return null;

  const [, itens] = escolhido;
  const referencia = itens[0].cmp as ComparacaoDePosicao;
  const noGrupo = new Set(itens.map((i) => i.texto));

  for (const item of parsed) {
    if (noGrupo.has(item.texto)) continue;
    if (!guardas.has(normalizarClausula(item.texto))) return null;
    // Uma guarda sobre a mesma faixa mudaria o domínio publicado.
    if (
      item.cmp &&
      item.cmp.alvo === referencia.alvo &&
      item.cmp.inicio0 === referencia.inicio0 &&
      item.cmp.fim0 === referencia.fim0
    ) {
      return null;
    }
  }

  return {
    tipo: "dominio",
    alvo: referencia.alvo,
    posicao: { inicio0: referencia.inicio0, fim0: referencia.fim0 },
    valores: itens.map((i) => (i.cmp as ComparacaoDePosicao).valor),
    sentido: "permitidos",
    comparacao: itens.some((i) => (i.cmp as ComparacaoDePosicao).comparacao === "frouxa")
      ? "frouxa"
      : "estrita",
  };
}

/**
 * Disjunção de igualdades sobre a mesma faixa: bater com qualquer um dos valores
 * é o erro. É o domínio escrito ao contrário, e precisa do sentido registrado —
 * um motor que leia `valores` como lista de permitidos inverte a regra.
 */
function inferirDominioProibidos(condicao: string): DslCondition | null {
  const clauses = splitLogicalClauses(condicao, "||");
  if (clauses.length < 2) return null;

  const cmps = clauses.map(parseComparacaoDePosicao);
  if (cmps.some((c) => c === null || c.operador !== "==")) return null;

  const validos = cmps as ComparacaoDePosicao[];
  const referencia = validos[0];
  const mesmaFaixa = validos.every(
    (c) =>
      c.alvo === referencia.alvo &&
      c.inicio0 === referencia.inicio0 &&
      c.fim0 === referencia.fim0
  );
  if (!mesmaFaixa) return null;

  return {
    tipo: "dominio",
    alvo: referencia.alvo,
    posicao: { inicio0: referencia.inicio0, fim0: referencia.fim0 },
    valores: validos.map((c) => c.valor),
    sentido: "proibidos",
    comparacao: validos.some((c) => c.comparacao === "frouxa") ? "frouxa" : "estrita",
  };
}

/** Combinações de teste residual que o fonte usa, e o que cada uma exige da faixa. */
const EXIGENCIA_POR_RESIDUO: Record<string, ExigenciaNumericoBranco> = {
  "\\s|==|0": "numerico_preenchido",
  "\\s|!=|0": "branco",
  "\\d|==|1": "numerico",
};

function inferirNumericoBranco(condicao: string): DslCondition | null {
  const partes = splitLogicalClauses(condicao, "||");
  if (partes.length !== 2) return null;

  const isNaNMatch = stripOuterParens(partes[0]).match(
    /^isNaN\((res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\)$/
  );
  if (!isNaNMatch) return null;

  const residuoMatch = stripOuterParens(partes[1]).match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\.replace\(\/(\\s|\\d)\/g,\s*(?:''|"")\)\.length\s*(===|!==|==|!=)\s*(\d+)$/
  );
  if (!residuoMatch) return null;

  const [, alvo, inicio, fim] = isNaNMatch;
  const [, alvoResiduo, inicioResiduo, fimResiduo, padrao, operadorFonte, valor] = residuoMatch;

  // As duas metades precisam ler exatamente a mesma faixa; do contrário a condição
  // mistura campos e não é este arquétipo.
  if (alvo !== alvoResiduo || inicio !== inicioResiduo || fim !== fimResiduo) return null;

  const operador = operadorFonte === "===" || operadorFonte === "==" ? "==" : "!=";
  const exige = EXIGENCIA_POR_RESIDUO[`${padrao}|${operador}|${valor}`];
  // Combinação nova no fonte: cai em `custom` com a condição preservada, em vez de
  // ser encaixada à força numa exigência que ela não faz.
  if (!exige) return null;

  return {
    tipo: "numerico_branco",
    alvo,
    posicao: { inicio0: parseInt(inicio, 10), fim0: parseInt(fim, 10) },
    exige,
    residuo: { padrao, operador, valor: parseInt(valor, 10) },
  };
}

function splitLogicalClauses(expr: string, operador: "&&" | "||"): string[] {
  const base = stripOuterParens(expr);
  const char0 = operador[0];

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

    if (char === char0 && base[i + 1] === char0 && depth === 0) {
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
