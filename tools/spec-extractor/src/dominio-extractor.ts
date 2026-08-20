import { parse } from "acorn";
import type {
  Node,
  Statement,
  Expression,
  BlockStatement,
  FunctionDeclaration,
  Program,
} from "acorn";

/**
 * Segundo modo de extração do fonte.
 *
 * O arquivo de retorno não tem a forma "condição → mensagem de erro" que o
 * `ast-walker` reconhece. Ele tem a forma **"campo igual a código → rótulo"**: é
 * uma tabela de domínio, não uma regra. Daí um arquivo de 32 mil linhas com
 * apenas algumas dezenas de mensagens de erro.
 *
 * O catálogo vive numa função **aninhada** dentro da função de layout, então este
 * extrator entra em declarações de função internas — o que o walker de regras não
 * faz.
 */

export interface EntradaDominio {
  codigo: string;
  rotulo: string;
  /** Condição extra no mesmo `if` — o fonte usa isso para excluir um segmento. */
  condicao_extra: string | null;
  linha_fonte: number;
}

export interface TabelaDominio {
  alvo: string;
  inicio0: number;
  fim0: number;
  /** 1-based inclusivo, como as mensagens. */
  colunas: [number, number];
  /** Identidade do bloco em que a tabela foi lida — permite cruzar tabelas irmãs. */
  bloco: string;
  /**
   * Fonte dos `if` que cercam a tabela, do mais externo para o mais interno.
   *
   * É a evidência mais direta de em que registros o campo é lido: a guarda é
   * literalmente o teste que decide se o bloco roda. A tabela irmã que decodifica
   * o tipo de registro diz o mesmo por outro caminho, mas só alcança os tipos que
   * o fonte **rotula** — e ele não rotula o detalhe, porque o rótulo dele já saiu
   * no bloco do segmento.
   */
  guardas: string[];
  entradas: EntradaDominio[];
}

interface Contexto {
  code: string;
  lineOffset: number;
  tabelas: Map<string, TabelaDominio>;
}

export function extrairTabelasDeDominio(
  code: string,
  functionName: string,
  lineOffset = 0
): TabelaDominio[] {
  const ast = parse(code, { ecmaVersion: "latest", locations: true }) as Program;
  const alvo = acharFuncao(ast.body, functionName);
  if (!alvo) return [];

  const ctx: Contexto = { code, lineOffset, tabelas: new Map() };
  visitar(alvo.body, ctx, "raiz", []);

  return [...ctx.tabelas.values()]
    .map((tabela) => ({ ...tabela, entradas: tabela.entradas.filter(ehEntrada) }))
    .filter(ehTabela)
    .sort((a, b) => a.inicio0 - b.inicio0 || a.bloco.localeCompare(b.bloco));
}

/** Régua de relatório e moldura não são rótulo de código. */
function ehEntrada(entrada: EntradaDominio): boolean {
  if (!/\p{L}/u.test(entrada.rotulo)) return false;
  return entrada.rotulo.length <= LIMITE_ROTULO;
}

const LIMITE_ROTULO = 200;

/**
 * Domínio tem código distinto por entrada. Código repetido é sinal de que o
 * bloco desenha um relatório em sequência, não de que decodifica um campo.
 */
function ehTabela(tabela: TabelaDominio): boolean {
  if (tabela.entradas.length < 2) return false;
  const codigos = new Set(tabela.entradas.map((e) => e.codigo));
  return codigos.size === tabela.entradas.length;
}

function acharFuncao(
  corpo: Statement[] | Node[],
  nome: string
): FunctionDeclaration | null {
  for (const stmt of corpo as Statement[]) {
    if (stmt.type === "FunctionDeclaration" && stmt.id?.name === nome) {
      return stmt;
    }
  }
  return null;
}

function visitar(
  stmt: Statement | null | undefined,
  ctx: Contexto,
  bloco: string,
  guardas: string[]
): void {
  if (!stmt) return;

  switch (stmt.type) {
    case "BlockStatement": {
      const id = `${bloco}/${stmt.start}`;
      for (const inner of stmt.body) visitar(inner, ctx, id, guardas);
      return;
    }
    case "IfStatement": {
      registrarEntrada(stmt, ctx, bloco, guardas);
      const doIf = [...guardas, ctx.code.slice(stmt.test.start, stmt.test.end)];
      visitar(stmt.consequent, ctx, bloco, doIf);
      // O `else` vale o contrário do teste, e o que interessa aqui é a inclusão
      // positiva: uma guarda negada não afirma em que registro o campo é lido.
      visitar(stmt.alternate, ctx, bloco, guardas);
      return;
    }
    case "ForStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "LabeledStatement":
      visitar(stmt.body as Statement, ctx, bloco, guardas);
      return;
    // É por aqui que o catálogo de ocorrências do retorno é alcançado.
    case "FunctionDeclaration": {
      if (stmt.body.type === "BlockStatement") {
        visitar(stmt.body, ctx, `${bloco}/fn:${stmt.id?.name ?? stmt.start}`, guardas);
      }
      return;
    }
    default:
      return;
  }
}

function registrarEntrada(
  stmt: Statement & { type: "IfStatement" },
  ctx: Contexto,
  bloco: string,
  guardas: string[]
): void {
  const comparacao = lerComparacao(stmt.test, ctx);
  if (!comparacao) return;

  const rotulo = lerRotulo(stmt.consequent, ctx);
  if (rotulo === null) return;

  const chave = `${bloco}|${comparacao.alvo}|${comparacao.inicio0}|${comparacao.fim0}`;
  const tabela = ctx.tabelas.get(chave) ?? {
    alvo: comparacao.alvo,
    inicio0: comparacao.inicio0,
    fim0: comparacao.fim0,
    colunas: [comparacao.inicio0 + 1, comparacao.fim0] as [number, number],
    bloco,
    guardas,
    entradas: [],
  };

  tabela.entradas.push({
    codigo: comparacao.codigo,
    rotulo,
    condicao_extra: comparacao.extra,
    linha_fonte: (stmt.loc?.start.line ?? 0) + ctx.lineOffset,
  });
  ctx.tabelas.set(chave, tabela);
}

interface ComparacaoDeCodigo {
  alvo: string;
  inicio0: number;
  fim0: number;
  codigo: string;
  extra: string | null;
}

/**
 * `alvo.substring(a, b) == codigo`, opcionalmente com uma segunda condição ligada
 * por `&&`. A segunda condição é preservada como texto: é o que diz, por exemplo,
 * que um código só vale fora de um certo segmento.
 */
function lerComparacao(test: Expression, ctx: Contexto): ComparacaoDeCodigo | null {
  if (test.type === "LogicalExpression" && test.operator === "&&") {
    const esquerda = lerComparacao(test.left as Expression, ctx);
    if (!esquerda || esquerda.extra) return null;
    return { ...esquerda, extra: fonte(test.right, ctx) };
  }

  if (test.type !== "BinaryExpression") return null;
  if (test.operator !== "==" && test.operator !== "===") return null;

  const leitura = lerSubstring(test.left as Node, ctx);
  if (!leitura) return null;

  const codigo = lerLiteral(test.right as Node, ctx);
  if (codigo === null) return null;

  return { ...leitura, codigo, extra: null };
}

function lerSubstring(
  node: Node,
  ctx: Contexto
): { alvo: string; inicio0: number; fim0: number } | null {
  if (node.type !== "CallExpression") return null;
  const call = node as import("acorn").CallExpression;
  if (call.callee.type !== "MemberExpression") return null;
  const callee = call.callee;
  if (callee.property.type !== "Identifier" || callee.property.name !== "substring") {
    return null;
  }
  if (call.arguments.length !== 2) return null;

  const inicio = lerInteiro(call.arguments[0] as Node);
  const fim = lerInteiro(call.arguments[1] as Node);
  if (inicio === null || fim === null) return null;

  return { alvo: fonte(callee.object, ctx), inicio0: inicio, fim0: fim };
}

function lerInteiro(node: Node): number | null {
  if (node.type !== "Literal") return null;
  const valor = (node as import("acorn").Literal).value;
  return typeof valor === "number" && Number.isInteger(valor) ? valor : null;
}

/**
 * O código pode vir como string (`"XX"`) ou como número sem aspas (`00`, que o
 * JavaScript lê como `0`). O texto do fonte é a forma fiel: `00` e `0` são o mesmo
 * valor para o validador, mas só a primeira tem a largura do campo.
 */
function lerLiteral(node: Node, ctx: Contexto): string | null {
  if (node.type !== "Literal") return null;
  const literal = node as import("acorn").Literal;
  if (typeof literal.value === "string") return literal.value;
  if (typeof literal.value === "number") return fonte(node, ctx);
  return null;
}

/** Concatenação de strings no `consequent`, sem o acumulador nem a marcação HTML. */
function lerRotulo(stmt: Statement, ctx: Contexto): string | null {
  const alvo = stmt.type === "BlockStatement" ? primeiraSentenca(stmt) : stmt;
  if (!alvo || alvo.type !== "ExpressionStatement") return null;

  const expr = alvo.expression;
  if (expr.type !== "AssignmentExpression") return null;
  if (expr.left.type !== "Identifier") return null;

  const partes = coletarTexto(expr.right as Node, expr.left.name, ctx);
  if (partes === null) return null;

  const texto = limpar(partes);
  return texto.length > 0 ? texto : null;
}

function primeiraSentenca(bloco: BlockStatement): Statement | null {
  return bloco.body.length === 1 ? bloco.body[0] : null;
}

/** `null` quando aparece algo que não é texto — leitura de campo, por exemplo. */
function coletarTexto(node: Node, acumulador: string, ctx: Contexto): string | null {
  if (node.type === "Literal") {
    const valor = (node as import("acorn").Literal).value;
    return typeof valor === "string" ? valor : null;
  }
  if (node.type === "Identifier") {
    return (node as import("acorn").Identifier).name === acumulador ? "" : null;
  }
  if (node.type === "BinaryExpression") {
    const bin = node as import("acorn").BinaryExpression;
    if (bin.operator !== "+") return null;
    const esquerda = coletarTexto(bin.left as Node, acumulador, ctx);
    const direita = coletarTexto(bin.right as Node, acumulador, ctx);
    if (esquerda === null || direita === null) return null;
    return esquerda + direita;
  }
  return null;
}

/**
 * O rótulo vem embrulhado em marcação e alinhado com espaços, e repete o código
 * antes de um travessão. O que interessa é o significado.
 */
function limpar(texto: string): string {
  return texto
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Do segundo código em diante o fonte separa com "/" antes de repetir o código.
    .replace(/^\/\s*/, "")
    .replace(/^[A-Za-z0-9]{1,3}\s*-\s*/, "")
    .trim();
}

function fonte(node: Node, ctx: Contexto): string {
  return ctx.code.slice(node.start, node.end);
}
