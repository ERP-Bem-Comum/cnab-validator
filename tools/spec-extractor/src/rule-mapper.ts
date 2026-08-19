import type { AtribuicaoFonte, RawRule } from "./ast-walker.js";

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
  | {
      tipo: "modulo_11";
      alvo: string;
      /** Faixa do dígito informado no arquivo. */
      posicao: { inicio0: number; fim0: number };
      /** Parcelas do somatório, na ordem do fonte. */
      base: {
        alvo: string;
        inicio0: number;
        fim0: number;
        peso: number;
        /** Função aplicada à parcela antes de multiplicar, quando existe. */
        transformacao: string | null;
      }[];
      modulo: number;
      /**
       * Dígito esperado por faixa de resto, na ordem em que o fonte decide. O
       * fonte repete o bloco de cálculo por valor informado no dígito, então uma
       * mesma faixa de resto pode ter resultado diferente em cada ramo — a guarda
       * da regra diz qual ramo é este.
       */
      resultado: {
        /** null quando a atribuição é incondicional — é o valor padrão do fonte. */
        operador: string | null;
        resto: number | null;
        /** Literal, quando o fonte atribui um literal. */
        valor: string | null;
        /** Expressão do fonte com a variável de resto renomeada para `resto`. */
        expressao: string;
      }[];
      /** Função aplicada à faixa antes de comparar, quando existe. */
      transformacao: string | null;
      /** Nome da variável do fonte que carrega o dígito calculado. */
      variavel: string;
      documento: string;
    }
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
   * Comparação relacional contra literal: `>`, `>=`, `<`, `<=`. Vários limites
   * sobre a mesma faixa descrevem um intervalo (o fonte usa `>= 'a' && <= 'z'`
   * para rejeitar minúscula). Com literal numérico a comparação é numérica; com
   * literal entre aspas é lexicográfica — daí `comparacao` valer aqui também.
   */
  | {
      tipo: "intervalo";
      alvo: string;
      posicao: { inicio0: number; fim0: number };
      limites: { operador: string; valor: string }[];
      comparacao: ModoComparacao;
    }
  /**
   * Disjunção do fonte: o validador encadeia com `||` vários testes sobre faixas
   * diferentes e emite uma única mensagem. Erro quando qualquer parte é verdadeira.
   * Só é publicada quando *todas* as partes têm arquétipo próprio — uma parte
   * `custom` derrubaria a regra inteira para `custom`, que é onde ela deve ficar.
   */
  | { tipo: "disjuncao"; alvo: string; partes: DslCondition[] }
  /**
   * Conjunção de testes sobre faixas diferentes com uma única mensagem — a
   * combinação proibida entre dois campos. Erro só quando todas as partes valem.
   */
  | { tipo: "conjuncao"; alvo: string; partes: DslCondition[] }
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

/** Faixa que o arquétipo validou, quando ele tem uma só. */
function posicaoDoArquetipo(
  condicao: DslCondition
): { inicio0: number; fim0: number } | null {
  switch (condicao.tipo) {
    case "literal_fixo":
    case "numerico_branco":
    case "dominio":
    case "intervalo":
    case "modulo_11":
    case "coerencia_registro":
      return condicao.posicao;
    default:
      return null;
  }
}

/** Todas as faixas que a condição lê do alvo, na ordem em que aparecem. */
function todasAsFaixas(
  condicao: string,
  alvo: string
): { inicio0: number; fim0: number }[] {
  const escaped = alvo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\.substring\\((\\d+),\\s*(\\d+)\\)`, "g");
  const faixas: { inicio0: number; fim0: number }[] = [];
  for (const m of condicao.matchAll(regex)) {
    faixas.push({ inicio0: parseInt(m[1], 10), fim0: parseInt(m[2], 10) });
  }
  return faixas;
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
  const condicao = inferirCondicao(condicaoPropria, {
    alvo,
    condicaoCompleta: raw.condicao_original,
    condicaoGuarda: raw.condicao_guarda ?? null,
    ambiente: raw.ambiente,
    mensagem: raw.mensagem,
  });

  let colunas: [number, number];
  let inicio0: number;
  let fim0: number;

  // Em condição composta cada parte lê a sua própria faixa: publicar só a
  // primeira esconderia metade do que a regra testa.
  const faixasCompostas =
    condicao.tipo === "disjuncao" || condicao.tipo === "conjuncao"
      ? faixasDaCondicao(condicao)
      : [];
  // O envelope de `colunas` só pode somar faixas do registro que a regra reprova.
  // Uma parte que lê `res[i + 2]` é sobre outra linha do arquivo: misturar as duas
  // produziria uma faixa que não existe em registro nenhum.
  const faixasDoAlvo = faixasCompostas.filter((f) => f.alvo === alvo);
  // A posição do arquétipo é mais confiável que a primeira `substring` do texto:
  // numa condição que lê duas faixas, a que a regra valida é a que o arquétipo
  // classificou.
  const posicoesCondicao =
    posicaoDoArquetipo(condicao) ?? extrairPosicoesDaCondicao(condicaoPropria, alvo);
  // Sem faixa na condição e sem faixa na mensagem, a regra não é sobre uma posição
  // (comprimento da linha, coerência entre linhas). Publicar uma posição inventada
  // faria um motor de validação ler a coluna errada.
  const semPosicao = faixasCompostas.length === 0 && !posicoesCondicao && !raw.colunas;
  if (faixasDoAlvo.length > 0) {
    inicio0 = Math.min(...faixasDoAlvo.map((f) => f.inicio0));
    fim0 = Math.max(...faixasDoAlvo.map((f) => f.fim0));
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
      : faixasCompostas.length > 0
        ? faixasCompostas.map((f) => ({
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
      case "intervalo":
        faixas.push({ alvo: c.alvo, inicio0: c.posicao.inicio0, fim0: c.posicao.fim0 });
        return;
      case "disjuncao":
      case "conjuncao":
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

/** O que a classificação precisa saber além do texto da condição própria. */
interface ContextoRegra {
  alvo: string;
  /** Conjunção completa (guardas + teste), onde a cadeia de domínio existe. */
  condicaoCompleta: string;
  condicaoGuarda: string | null;
  /** Variáveis do fonte que a condição referencia (dígito calculado, resto). */
  ambiente?: Record<string, AtribuicaoFonte[]>;
  mensagem: string;
}

function inferirCondicao(condicaoPropria: string, ctx: ContextoRegra): DslCondition {
  const simples = inferirCondicaoSimples(condicaoPropria, ctx);
  if (simples.tipo !== "custom") return simples;

  return inferirComposta(stripOuterParens(condicaoPropria), ctx) ?? simples;
}

/**
 * Condição que só se descreve como combinação de outras. Roda depois dos
 * arquétipos que já são combinações com nome próprio (`dominio`,
 * `numerico_branco`), que descrevem melhor os casos que cobrem.
 */
function inferirComposta(condicao: string, ctx: ContextoRegra): DslCondition | null {
  return (
    inferirDisjuncao(condicao, ctx) ??
    inferirComposicao(condicao, ctx, "&&", "conjuncao")
  );
}

/** Classifica uma parte de uma composta: simples primeiro, composta se preciso. */
function inferirParte(parte: string, ctx: ContextoRegra): DslCondition {
  const contextoDaParte = { ...ctx, condicaoCompleta: parte };
  const simples = inferirCondicaoSimples(parte, contextoDaParte);
  if (simples.tipo !== "custom") return simples;
  return inferirComposta(stripOuterParens(parte), contextoDaParte) ?? simples;
}

/**
 * Tenta reconhecer a condição como uma única disjunção de partes já modeladas.
 * Roda depois dos arquétipos que também são disjunções (`numerico_branco`,
 * `dominio` proibido), que descrevem melhor os casos que cobrem.
 */
function inferirDisjuncao(condicao: string, ctx: ContextoRegra): DslCondition | null {
  return inferirComposicao(condicao, ctx, "||", "disjuncao");
}

function inferirComposicao(
  condicao: string,
  ctx: ContextoRegra,
  operador: "&&" | "||",
  tipo: "conjuncao" | "disjuncao"
): DslCondition | null {
  const partes = splitLogicalClauses(condicao, operador);
  if (partes.length < 2) return null;

  const modeladas: DslCondition[] = [];
  let i = 0;
  while (i < partes.length) {
    // `isNaN(faixa) || faixa.replace(...)` é um arquétipo só escrito em duas
    // cláusulas: sem juntar o par, cada metade isolada não significa nada. O par
    // é classificado só pelos arquétipos simples — tentar a composta aqui
    // reentraria nesta mesma expressão quando ela tem exatamente duas partes.
    const parTexto =
      operador === "||" && i + 1 < partes.length
        ? `${partes[i]} || ${partes[i + 1]}`
        : null;
    const par = parTexto
      ? inferirCondicaoSimples(parTexto, { ...ctx, condicaoCompleta: parTexto })
      : null;
    if (par && par.tipo !== "custom") {
      modeladas.push(par);
      i += 2;
      continue;
    }

    const isolada = inferirParte(partes[i], ctx);
    if (isolada.tipo === "custom") return null;
    modeladas.push(isolada);
    i += 1;
  }

  if (modeladas.length < 2) return null;
  return { tipo, alvo: ctx.alvo, partes: modeladas };
}

function inferirCondicaoSimples(
  condicaoPropria: string,
  ctx: ContextoRegra
): DslCondition {
  const { alvo, condicaoGuarda, ambiente, mensagem } = ctx;
  const condicao = stripOuterParens(condicaoPropria);
  const posicaoPropria = extrairPosicoesDaCondicao(condicao, alvo);
  const posicoesProprias = todasAsFaixas(condicao, alvo);

  // Fusão de cadeia: o fonte expressa domínio negado encadeando `if` aninhados sobre
  // a mesma posição, um valor por nível, com uma única mensagem no nível mais interno.
  // A cadeia só existe na conjunção completa; as cláusulas que sobram precisam ser
  // guardas conhecidas, senão fundir perderia parte do teste.
  const cadeia = inferirDominioPermitidos(
    stripOuterParens(ctx.condicaoCompleta),
    clausulasDaGuarda(condicaoGuarda),
    posicoesProprias
  );
  if (cadeia) return cadeia;

  // Dominio: cadeia de alvo.substring(a,b) != "valor" conectadas por && no mesmo `if`
  const dominio = inferirDominioPermitidos(condicao, new Set(), posicoesProprias);
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

  // Relacional: `faixa > "31"`, ou o par `>= 'a' && <= 'z'` que rejeita minúscula.
  const intervalo = inferirIntervalo(condicao);
  if (intervalo) return intervalo;

  // Módulo 11: o fonte calcula o dígito numa variável, antes do `if`, e aqui só
  // compara a faixa com ela. Sem o ambiente capturado pelo walker a condição é
  // ilegível — é literalmente `res[0].substring(57, 58) != dva`.
  const modulo11 = inferirModulo11(condicao, ambiente, mensagem);
  if (modulo11) return modulo11;

  // Coerência entre duas leituras: a mesma faixa em linhas distintas (`res[i]`
  // contra `res[j]` ou `res[i + 1]`), que sustenta "banco único por lote", ou
  // dois campos da mesma linha, que é como o fonte compara datas entre si. O
  // operador relacional faz parte: "data do desconto superior à do vencimento" é
  // exatamente uma comparação de faixa contra faixa.
  const coerencia = condicao.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(===|!==|==|!=|>=|<=|>|<)\s*(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)$/
  );
  if (coerencia) {
    const [, alvoA, a1, b1, operador, alvoB, a2, b2] = coerencia;
    // Faixa comparada consigo mesma não é regra; é sempre verdadeira ou sempre falsa.
    const mesmaLeitura = alvoA === alvoB && a1 === a2 && b1 === b2;
    if (!mesmaLeitura) {
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

/**
 * Divide uma conjunção até o fim, entrando nos parênteses.
 *
 * O fonte agrupa a cadeia de desigualdades dentro de um `if` já parentizado, e o
 * split de um nível só devolve `(A && B)` como cláusula única — o que esconde a
 * cadeia do matcher de domínio.
 */
function splitConjuncaoProfunda(expr: string): string[] {
  const partes = splitLogicalClauses(expr, "&&");
  if (partes.length === 1) return partes;
  return partes.flatMap((parte) =>
    // Uma parte que ainda é conjunção vira as suas próprias cláusulas.
    splitLogicalClauses(parte, "&&").length > 1 ? splitConjuncaoProfunda(parte) : [parte]
  );
}

function normalizarClausula(clausula: string): string {
  return stripOuterParens(clausula).replace(/\s+/g, " ").trim();
}

function clausulasDaGuarda(guarda: string | null): Set<string> {
  if (!guarda) return new Set();
  return new Set(splitConjuncaoProfunda(guarda).map(normalizarClausula));
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
  posicoesProprias: { inicio0: number; fim0: number }[]
): DslCondition | null {
  // `a && b || c` é uma disjunção, não uma conjunção: dividir por && daria uma
  // leitura errada da expressão.
  if (splitLogicalClauses(condicao, "||").length > 1) return null;

  const clauses = splitConjuncaoProfunda(condicao);
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

  // Com mais de uma cadeia na mesma conjunção, só a que cobre uma das faixas lidas
  // pela condição própria é a regra em questão; as outras pertencem a outra regra
  // do fonte. A condição própria pode ler mais de uma faixa — o fonte combina o
  // tipo de serviço com a forma de lançamento no mesmo `if`.
  const escolhido =
    candidatos.length === 1 && posicoesProprias.length === 0
      ? candidatos[0]
      : candidatos.find(([, itens]) => {
          const cmp = itens[0].cmp as ComparacaoDePosicao;
          return posicoesProprias.some(
            (posicao) => cmp.inicio0 === posicao.inicio0 && cmp.fim0 === posicao.fim0
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

const RELACIONAIS = /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(>=|<=|>|<)\s*(?:"([^"]*)"|'([^']*)'|(\d+))$/;

function inferirIntervalo(condicao: string): DslCondition | null {
  // Uma disjunção no topo não é um intervalo; deixa para o arquétipo composto.
  if (splitLogicalClauses(condicao, "||").length > 1) return null;

  const clauses = splitLogicalClauses(condicao, "&&");
  const casadas = clauses.map((c) => stripOuterParens(c).match(RELACIONAIS));
  if (casadas.some((m) => m === null)) return null;

  const validas = casadas as RegExpMatchArray[];
  const [, alvo, inicio, fim] = validas[0];
  const mesmaFaixa = validas.every(
    (m) => m[1] === alvo && m[2] === inicio && m[3] === fim
  );
  if (!mesmaFaixa) return null;

  return {
    tipo: "intervalo",
    alvo,
    posicao: { inicio0: parseInt(inicio, 10), fim0: parseInt(fim, 10) },
    limites: validas.map((m) => ({
      operador: m[4],
      valor: m[5] ?? m[6] ?? m[7],
    })),
    // `substring()` devolve string: contra literal numérico o JavaScript coage e
    // compara números; entre aspas a comparação é lexicográfica.
    comparacao: validas.some((m) => m[5] === undefined && m[6] === undefined)
      ? "frouxa"
      : "estrita",
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

/**
 * O fonte calcula o dígito verificador antes do `if` — soma ponderada, resto da
 * divisão, e um `if` por faixa de resto atribuindo o dígito esperado a uma
 * variável. A condição da regra só compara a faixa com essa variável, então o
 * arquétipo só se resolve com o ambiente que o walker capturou.
 */
function inferirModulo11(
  condicao: string,
  ambiente: Record<string, AtribuicaoFonte[]> | undefined,
  mensagem: string
): DslCondition | null {
  if (!ambiente) return null;

  const comFuncao = condicao.match(
    /^([A-Za-z_$][\w$]*)\((res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\)\s*(!==|!=)\s*([A-Za-z_$][\w$]*)$/
  );
  const direto = condicao.match(
    /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*(!==|!=)\s*([A-Za-z_$][\w$]*)$/
  );
  if (!comFuncao && !direto) return null;

  const transformacao = comFuncao ? comFuncao[1] : null;
  const [alvo, inicio, fim, variavel] = comFuncao
    ? [comFuncao[2], comFuncao[3], comFuncao[4], comFuncao[6]]
    : [direto![1], direto![2], direto![3], direto![5]];

  const resultado = resolverResultado(variavel, ambiente);
  if (!resultado) return null;

  const calculo = resolverResto(resultado.varResto, ambiente);
  if (!calculo) return null;

  return {
    tipo: "modulo_11",
    alvo,
    posicao: { inicio0: parseInt(inicio, 10), fim0: parseInt(fim, 10) },
    base: calculo.base,
    modulo: calculo.modulo,
    resultado: resultado.faixas,
    transformacao,
    variavel,
    documento: inferirDocumento(`${condicao} ${mensagem}`),
  };
}

interface ResultadoDoDigito {
  varResto: string;
  faixas: {
    operador: string | null;
    resto: number | null;
    valor: string | null;
    expressao: string;
  }[];
}

/**
 * O fonte escreve o dígito esperado em duas formas: um valor padrão
 * incondicional (`dv1 = 11 - resto1`) que os `if` seguintes sobrescrevem, e um
 * `if` por faixa de resto. A ordem é significativa — a última atribuição que
 * casa é a que vale —, então `faixas` preserva a ordem do fonte.
 */
function resolverResultado(
  variavel: string,
  ambiente: Record<string, AtribuicaoFonte[]>
): ResultadoDoDigito | null {
  const atribuicoes = ambiente[variavel];
  if (!atribuicoes || atribuicoes.length === 0) return null;

  let varResto: string | null = null;
  const brutas: { quando: string | null; expressao: string }[] = [];

  for (const a of atribuicoes) {
    if (a.operador !== "=") return null;

    if (!a.quando) {
      brutas.push({ quando: null, expressao: a.expressao });
      continue;
    }

    const guarda = stripOuterParens(a.quando).match(
      /^([A-Za-z_$][\w$]*)\s*(===|!==|==|!=|>=|<=|>|<)\s*(\d+)$/
    );
    if (!guarda) return null;

    const [, nome] = guarda;
    if (varResto && varResto !== nome) return null;
    varResto = nome;
    brutas.push({ quando: a.quando, expressao: a.expressao });
  }

  // Sem nenhuma condicional, a variável de resto só pode vir do valor padrão.
  if (!varResto) {
    varResto =
      brutas
        .flatMap((b) => b.expressao.match(/[A-Za-z_$][\w$]*/g) ?? [])
        .find((nome) => ambiente[nome] !== undefined) ?? null;
  }
  if (!varResto || brutas.length === 0) return null;

  const nomeResto = varResto;
  const faixas = brutas.map((b) => {
    const guarda = b.quando
      ? stripOuterParens(b.quando).match(
          /^([A-Za-z_$][\w$]*)\s*(===|!==|==|!=|>=|<=|>|<)\s*(\d+)$/
        )
      : null;
    const literal = b.expressao.match(/^(?:"([^"]*)"|'([^']*)'|(\d+))$/);
    return {
      operador: guarda ? guarda[2] : null,
      resto: guarda ? parseInt(guarda[3], 10) : null,
      valor: literal ? (literal[1] ?? literal[2] ?? literal[3]) : null,
      // A expressão viaja com o nome canônico `resto`: um motor não conhece o
      // nome que a variável tem no fonte.
      expressao: b.expressao.replace(new RegExp(`\\b${nomeResto}\\b`, "g"), "resto"),
    };
  });

  return { varResto, faixas };
}

type ParcelaBase = {
  alvo: string;
  inicio0: number;
  fim0: number;
  peso: number;
  transformacao: string | null;
};

function resolverResto(
  varResto: string,
  ambiente: Record<string, AtribuicaoFonte[]>
): { base: ParcelaBase[]; modulo: number } | null {
  const atribuicoes = ambiente[varResto];
  if (!atribuicoes || atribuicoes.length === 0) return null;

  let fonte: string | null = null;
  let modulo: number | null = null;

  for (const a of atribuicoes) {
    if (a.operador === "=") {
      const comModulo = a.expressao.match(/^(.+?)\s*%\s*(\d+)$/);
      if (comModulo) {
        fonte = comModulo[1];
        modulo = parseInt(comModulo[2], 10);
      } else {
        fonte = a.expressao;
      }
      continue;
    }
    if (a.operador === "%=") {
      const valor = a.expressao.match(/^(\d+)$/);
      if (!valor) return null;
      modulo = parseInt(valor[1], 10);
      continue;
    }
    return null;
  }

  if (!fonte || modulo === null) return null;

  // A soma costuma estar numa variável intermediária (`sm`).
  const somaFonte = fonte.match(/^[A-Za-z_$][\w$]*$/)
    ? ultimaExpressao(ambiente[fonte])
    : fonte;
  if (!somaFonte) return null;

  const base = parseSomaPonderada(somaFonte);
  if (!base) return null;

  return { base, modulo };
}

function ultimaExpressao(atribuicoes: AtribuicaoFonte[] | undefined): string | null {
  if (!atribuicoes || atribuicoes.length === 0) return null;
  const ultima = atribuicoes[atribuicoes.length - 1];
  return ultima.operador === "=" ? ultima.expressao : null;
}

function parseSomaPonderada(expressao: string): ParcelaBase[] | null {
  const parcelas = splitSoma(expressao);
  if (parcelas.length < 2) return null;

  // O CNPJ alfanumérico passa cada posição por uma função antes de multiplicar.
  const comFuncao =
    /^([A-Za-z_$][\w$]*)\((res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\)\s*\*\s*(\d+)$/;
  const direta = /^(res\[[^\]]+\])\.substring\((\d+),\s*(\d+)\)\s*\*\s*(\d+)$/;

  const base: ParcelaBase[] = [];
  for (const parcela of parcelas) {
    const m1 = parcela.match(comFuncao);
    const m2 = m1 ? null : parcela.match(direta);
    if (!m1 && !m2) return null;

    const [transformacao, alvo, inicio, fim, peso] = m1
      ? [m1[1], m1[2], m1[3], m1[4], m1[5]]
      : [null, m2![1], m2![2], m2![3], m2![4]];

    base.push({
      alvo,
      inicio0: parseInt(inicio, 10),
      fim0: parseInt(fim, 10),
      peso: parseInt(peso, 10),
      transformacao,
    });
  }
  return base;
}

/** Soma no nível de topo: `+` dentro de `res[i + 1]` ou de parênteses não separa parcela. */
function splitSoma(expressao: string): string[] {
  const partes: string[] = [];
  let atual = "";
  let profundidade = 0;

  for (const char of stripOuterParens(expressao)) {
    if (char === "(" || char === "[") profundidade++;
    else if (char === ")" || char === "]") profundidade--;

    if (char === "+" && profundidade === 0) {
      partes.push(atual.trim());
      atual = "";
      continue;
    }
    atual += char;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

function inferirDocumento(texto: string): string {
  // A pista costuma estar na mensagem, que é escrita em português com acento.
  const normalizado = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (normalizado.includes("cnpj")) return "cnpj";
  if (normalizado.includes("cpf")) return "cpf";
  if (normalizado.includes("agencia")) return "agencia";
  if (normalizado.includes("conta")) return "conta";
  return "desconhecido";
}
