import { parse } from "acorn";
import { simple } from "acorn-walk";
import type { FamiliaLayout } from "./config.js";
import type {
  Node,
  Statement,
  Expression,
  FunctionDeclaration,
  AnonymousFunctionDeclaration,
  FunctionExpression,
  ArrowFunctionExpression,
  BlockStatement,
  BinaryExpression,
  LogicalExpression,
  UnaryExpression,
  CallExpression,
  Literal,
  MemberExpression,
  Identifier,
  VariableDeclarator,
} from "acorn";

export interface RawRule {
  funcao_origem: string;
  linha_fonte: number;
  /** Conjunção completa: guardas externas + teste próprio. Rastreabilidade ao fonte. */
  condicao_original: string;
  /** Só as guardas dos `if` externos, ou null quando a regra está no nível raiz. */
  condicao_guarda?: string | null;
  /** Só o teste do `if` que emite a mensagem — é o que a DSL classifica. */
  condicao_propria?: string;
  mensagem: string;
  registro: string | null;
  /** Segundo registro citado na mensagem (gancho para `coerencia_registro`). */
  registro_referenciado?: string | null;
  /** De onde veio `registro`: da guarda estrutural ou do texto da mensagem. */
  registro_origem?: "guarda" | "mensagem" | null;
  colunas: [number, number] | null;
  alvo: string | null;
  /**
   * Variáveis do fonte que a condição própria referencia, com o que as define.
   * O validador calcula dígito verificador fora do `if` e compara a faixa com a
   * variável; sem o que está aqui, a regra é ilegível para um motor.
   */
  ambiente?: Record<string, AtribuicaoFonte[]>;
}

/** Atribuição como o walker a viu: guarda a pilha inteira para decidir visibilidade. */
interface AtribuicaoInterna {
  operador: string;
  expressao: string;
  guardas: string[];
  ordem: number;
}

/** Uma atribuição a uma variável do fonte, na ordem em que o walker a encontrou. */
export interface AtribuicaoFonte {
  /** `=`, `%=`, `+=`… como escrito no fonte. */
  operador: string;
  /** Código-fonte do lado direito. */
  expressao: string;
  /** Guardas que valiam para esta atribuição e não valem para a regra que a lê. */
  quando: string | null;
  ordem: number;
}

/** Guarda de um `if` externo: o código-fonte do teste mais o nó para análise estrutural. */
interface Guard {
  source: string;
  test: Expression;
  negada: boolean;
}

export function extractRulesFromFunction(
  code: string,
  functionName: string,
  lineOffset: number = 0,
  familia: FamiliaLayout = "cnab240"
): RawRule[] {
  const ast = parse(code, { ecmaVersion: "latest", locations: true });
  let targetBody: BlockStatement | undefined;

  simple(ast, {
    FunctionDeclaration(node: FunctionDeclaration | AnonymousFunctionDeclaration) {
      if (node.id?.name !== functionName) return;
      if (node.body.type !== "BlockStatement") return;
      targetBody = node.body;
    },
    VariableDeclarator(node: VariableDeclarator) {
      if (
        node.id?.type !== "Identifier" ||
        node.id.name !== functionName ||
        !node.init
      ) {
        return;
      }
      if (
        node.init.type === "FunctionExpression" ||
        node.init.type === "ArrowFunctionExpression"
      ) {
        const fn = node.init as FunctionExpression | ArrowFunctionExpression;
        if (fn.body.type !== "BlockStatement") return;
        targetBody = fn.body;
      }
    },
  });

  const rules: RawRule[] = [];
  if (targetBody) {
    const ctx: WalkContext = {
      code,
      functionName,
      rules,
      lineOffset,
      familia,
      variaveis: new Map(),
      ordem: { valor: 0 },
    };
    for (const stmt of targetBody.body) {
      visitStatement(stmt, ctx, []);
    }
  }

  return rules;
}

interface WalkContext {
  code: string;
  functionName: string;
  rules: RawRule[];
  lineOffset: number;
  familia: FamiliaLayout;
  /** Atribuições vistas até aqui, por nome de variável. */
  variaveis: Map<string, AtribuicaoInterna[]>;
  /** Ordem global das atribuições, para desempatar quem redefine quem. */
  ordem: { valor: number };
}

function visitStatement(stmt: Statement, ctx: WalkContext, guards: Guard[]): void {
  switch (stmt.type) {
    case "IfStatement": {
      const testSource = ctx.code.slice(stmt.test.start, stmt.test.end);
      const targets = findResMembers(stmt.test);
      const message = extractConcatenatedMessage(stmt.consequent, ctx.code);
      if (message && !isNoise(message)) {
        emitRule(ctx, stmt, message, testSource, guards, targets[0] ?? null);
      }

      const guardPositiva: Guard = { source: testSource, test: stmt.test, negada: false };
      visitWithGuard(stmt.consequent, ctx, guards, guardPositiva);

      if (stmt.alternate) {
        const negated = `!(${testSource})`;
        const guardNegativa: Guard = { source: negated, test: stmt.test, negada: true };
        if (stmt.alternate.type === "IfStatement") {
          visitStatement(stmt.alternate, ctx, [...guards, guardNegativa]);
        } else if (
          stmt.alternate.type === "BlockStatement" ||
          stmt.alternate.type === "ExpressionStatement"
        ) {
          const altMessage = extractConcatenatedMessage(stmt.alternate, ctx.code);
          if (altMessage && !isNoise(altMessage)) {
            emitRule(
              ctx,
              stmt.alternate,
              altMessage,
              negated,
              guards,
              targets[0] ?? null
            );
          }
          visitWithGuard(stmt.alternate, ctx, guards, guardNegativa);
        } else {
          visitStatement(stmt.alternate, ctx, [...guards, guardNegativa]);
        }
      }
      break;
    }
    case "ForStatement":
    case "WhileStatement": {
      const body = stmt.body;
      if (body.type === "BlockStatement") {
        visitBlock(body, ctx, guards);
      }
      break;
    }
    case "BlockStatement": {
      visitBlock(stmt, ctx, guards);
      break;
    }
    case "ExpressionStatement": {
      registrarAtribuicao(stmt.expression, ctx, guards);
      break;
    }
    case "VariableDeclaration": {
      for (const decl of stmt.declarations) {
        if (decl.id.type !== "Identifier" || !decl.init) continue;
        registrarValor(
          decl.id.name,
          "=",
          ctx.code.slice(decl.init.start, decl.init.end),
          ctx,
          guards
        );
      }
      break;
    }
  }
}

function registrarAtribuicao(
  expr: Expression,
  ctx: WalkContext,
  guards: Guard[]
): void {
  if (expr.type !== "AssignmentExpression") return;
  if (expr.left.type !== "Identifier") return;
  registrarValor(
    expr.left.name,
    expr.operator,
    ctx.code.slice(expr.right.start, expr.right.end),
    ctx,
    guards
  );
}

/**
 * Acumulador de mensagem do fonte (`resposta = resposta + "…"`) não é dado de
 * regra. O corte é pelo texto embutido, não pelo tamanho da expressão: o
 * somatório do dígito de CNPJ tem doze parcelas, cada uma com uma chamada de
 * função, e passa de 600 caracteres.
 */
const LIMITE_EXPRESSAO = 1400;
const LIMITE_LITERAL = 20;

function pareceMensagem(expressao: string): boolean {
  if (expressao.includes("<br>")) return true;
  const literais = expressao.match(/"[^"]*"|'[^']*'/g) ?? [];
  return literais.some((literal) => literal.length - 2 > LIMITE_LITERAL);
}

function registrarValor(
  nome: string,
  operador: string,
  expressao: string,
  ctx: WalkContext,
  guards: Guard[]
): void {
  if (pareceMensagem(expressao) || expressao.length > LIMITE_EXPRESSAO) return;

  const lista = ctx.variaveis.get(nome) ?? [];
  lista.push({
    operador,
    expressao,
    guardas: guards.map((g) => `(${g.source})`),
    ordem: ctx.ordem.valor++,
  });
  ctx.variaveis.set(nome, lista);
}

const IDENTIFICADORES_IGNORADOS = new Set([
  "res",
  "substring",
  "isNaN",
  "replace",
  "length",
  "parseInt",
  "parseFloat",
  "Number",
  "String",
  "Math",
  "g",
  "i",
  "j",
  "true",
  "false",
  "null",
  "undefined",
]);

function identificadoresLivres(expressao: string): string[] {
  const encontrados = expressao.match(/[A-Za-z_$][\w$]*/g) ?? [];
  return encontrados.filter((nome) => !IDENTIFICADORES_IGNORADOS.has(nome));
}

/**
 * Ambiente que a regra precisa para ser lida: as variáveis que a condição cita, e
 * transitivamente as que *elas* citam — o dígito depende do resto, que depende da
 * soma ponderada. `quando` guarda só as guardas que a atribuição tem a mais que a
 * regra, que é o ramo do cálculo (`resto == 0`, `resto > 1`).
 */
function ambienteDaCondicao(
  condicao: string,
  ctx: WalkContext,
  guards: Guard[],
  ordemDaRegra: number
): Record<string, AtribuicaoFonte[]> | undefined {
  const guardasDaRegra = guards.map((g) => `(${g.source})`);
  const ambiente: Record<string, AtribuicaoFonte[]> = {};
  const pendentes = identificadoresLivres(condicao);
  const vistos = new Set<string>();

  while (pendentes.length > 0) {
    const nome = pendentes.shift() as string;
    if (vistos.has(nome)) continue;
    vistos.add(nome);

    const atribuicoes = (ctx.variaveis.get(nome) ?? []).filter(
      (a) => a.ordem < ordemDaRegra && visivelPara(a, guardasDaRegra)
    );
    if (atribuicoes.length === 0) continue;

    ambiente[nome] = atribuicoes.map((a) => ({
      operador: a.operador,
      expressao: a.expressao,
      quando: quandoRelativo(a, guardasDaRegra),
      ordem: a.ordem,
    }));

    for (const a of atribuicoes) {
      pendentes.push(...identificadoresLivres(a.expressao));
      for (const guarda of a.guardas) pendentes.push(...identificadoresLivres(guarda));
    }
  }

  return Object.keys(ambiente).length > 0 ? ambiente : undefined;
}

/**
 * Uma atribuição só alcança a regra se valia onde a regra está: toda guarda da
 * regra precisa valer também para a atribuição. Sem isso, o ramo irmão do cálculo
 * — o fonte repete o bloco inteiro para cada valor informado no dígito — vazaria
 * para dentro da regra e o spec publicaria dois resultados contraditórios.
 */
function visivelPara(atribuicao: AtribuicaoInterna, guardasDaRegra: string[]): boolean {
  const daAtribuicao = new Set(atribuicao.guardas);
  return guardasDaRegra.every((g) => daAtribuicao.has(g));
}

function quandoRelativo(
  atribuicao: AtribuicaoInterna,
  guardasDaRegra: string[]
): string | null {
  const daRegra = new Set(guardasDaRegra);
  const restantes = atribuicao.guardas.filter((g) => !daRegra.has(g));
  return restantes.length > 0 ? restantes.join(" && ") : null;
}

function emitRule(
  ctx: WalkContext,
  node: Statement,
  mensagem: string,
  condicaoPropria: string,
  guards: Guard[],
  alvo: string | null
): void {
  const classificacao = classificarRegistro(mensagem, guards, alvo, ctx.familia);

  ctx.rules.push({
    funcao_origem: ctx.functionName,
    linha_fonte: (node.loc?.start.line ?? 0) + ctx.lineOffset,
    condicao_original: combineTests(condicaoPropria, guards),
    condicao_guarda: guards.length ? joinGuards(guards) : null,
    condicao_propria: condicaoPropria,
    mensagem,
    registro: classificacao.registro,
    registro_referenciado: classificacao.referenciado,
    registro_origem: classificacao.origem,
    colunas: extrairColunas(mensagem),
    alvo,
    ambiente: ambienteDaCondicao(condicaoPropria, ctx, guards, ctx.ordem.valor++),
  });
}

function visitWithGuard(
  stmt: Statement,
  ctx: WalkContext,
  guards: Guard[],
  guard: Guard
): void {
  if (stmt.type === "BlockStatement") {
    visitBlock(stmt, ctx, [...guards, guard]);
  } else {
    visitStatement(stmt, ctx, [...guards, guard]);
  }
}

function visitBlock(block: BlockStatement, ctx: WalkContext, guards: Guard[]): void {
  for (const inner of block.body) {
    visitStatement(inner, ctx, guards);
  }
}

function joinGuards(guards: Guard[]): string {
  return guards.map((g) => `(${g.source})`).join(" && ");
}

function combineTests(test: string, guards: Guard[]): string {
  if (guards.length === 0) return test;
  return `${joinGuards(guards)} && (${test})`;
}

function isNoise(message: string): boolean {
  const normalized = message.toLowerCase();
  if (normalized.includes("foi validado") || normalized.includes("não necessita de ajustes")) {
    return true;
  }
  // Duas evidências independentes de que a mensagem é um achado, não relatório.
  // Nenhuma das duas basta sozinha: o fonte tem regra que não cita coluna
  // (comprimento do registro) e regra cujo texto não usa nenhuma palavra de erro
  // ("Número do banco diferente no mesmo lote"), e tem render que cita coluna.
  const temLinha = /linha\s*(\{linha\}|\{valor\}|\d+)/i.test(message);
  const temColuna = /colunas?\s*\d/i.test(message);
  const indicator = /(inválid|invalid|falhou|falha|erro|incorret|divergent|obrigatório|obrigatorio|deixar em branco|informar|zerad|ausente|reprovad|não|exclusivo|apenas|somente|obrigado)/i;
  return !((temLinha && temColuna) || indicator.test(message));
}

function extractConcatenatedMessage(
  stmt: Statement,
  code: string
): string | null {
  if (stmt.type === "BlockStatement") {
    for (const inner of stmt.body) {
      const msg = extractConcatenatedMessage(inner, code);
      if (msg) return msg;
    }
    return null;
  }

  if (
    stmt.type === "ExpressionStatement" &&
    stmt.expression.type === "AssignmentExpression"
  ) {
    const { left, right } = stmt.expression;
    // `str = str + "..."` acumula: o próprio acumulador não faz parte da mensagem.
    const acumulador = left.type === "Identifier" ? left.name : null;
    if (isLiteralString(right)) {
      return right.value;
    }
    if (isAddExpression(right)) {
      return extractStringFromExpression(right, code, acumulador);
    }
  }

  return null;
}

function isLiteral(node: Node): node is Literal {
  return node.type === "Literal";
}

function isLiteralString(node: Node): node is Literal & { value: string } {
  return isLiteral(node) && typeof node.value === "string";
}

function isAddExpression(node: Node): node is BinaryExpression {
  return node.type === "BinaryExpression" && (node as BinaryExpression).operator === "+";
}

/** Uma soma só é concatenação de mensagem se algum operando é literal de texto. */
function contemStringLiteral(node: Node): boolean {
  if (isLiteralString(node)) return true;
  if (isAddExpression(node)) {
    return contemStringLiteral(node.left) || contemStringLiteral(node.right);
  }
  return false;
}

/**
 * O fonte monta a mensagem interpolando o índice da linha corrente
 * (`"Linha " + (i + 1) + ", colunas..."`). Nós não-literais viram placeholder
 * nomeado em vez de string vazia, para que a mensagem publicada no spec não
 * perca a referência de linha.
 */
function placeholderPara(expr: Node, code: string): string {
  const source = code.slice(expr.start, expr.end).trim();
  const leituraDeCampo = source.includes("res[") || source.includes(".");
  const indiceAritmetico = /^[\s()ij0-9+\-*]+$/.test(source) && /\b[ij]\b/.test(source);
  return !leituraDeCampo && indiceAritmetico ? "{linha}" : "{valor}";
}

function extractStringFromExpression(
  expr: Node,
  code: string,
  acumulador: string | null = null
): string {
  if (isLiteralString(expr)) {
    return expr.value;
  }
  if (acumulador && expr.type === "Identifier" && (expr as Identifier).name === acumulador) {
    return "";
  }
  if (isAddExpression(expr) && contemStringLiteral(expr)) {
    return (
      extractStringFromExpression(expr.left, code, acumulador) +
      extractStringFromExpression(expr.right, code, acumulador)
    );
  }
  return placeholderPara(expr, code);
}

// --- Classificação do tipo de registro -------------------------------------

/**
 * Posição (0-based, fim exclusivo) que carrega o tipo de registro em cada família.
 * CNAB 240: posição 008. CNAB 400 e 200: coluna 001.
 */
export const POSICAO_TIPO_REGISTRO: Record<FamiliaLayout, [number, number]> = {
  cnab240: [7, 8],
  cnab400: [0, 1],
  cnab200: [0, 1],
};

/** Só o CNAB 240 tem código de segmento (coluna 014). */
const POSICAO_SEGMENTO: Partial<Record<FamiliaLayout, [number, number]>> = {
  cnab240: [13, 14],
};

const TIPO_REGISTRO_240: Record<string, string> = {
  "0": "header-arquivo",
  "1": "header-lote",
  "3": "detalhe",
  "5": "trailer-lote",
  "9": "trailer-arquivo",
};

/**
 * No CNAB 400/200 apenas os tipos 0 e 9 têm nome canônico — as próprias mensagens
 * do fonte os chamam de header e trailer de arquivo. Os intermediários ficam com
 * rótulo neutro derivado do código, para não atribuir semântica que o fonte não afirma.
 */
export function tipoRegistroPorFamilia(valor: string, familia: FamiliaLayout): string {
  if (familia === "cnab240") return TIPO_REGISTRO_240[valor] ?? `registro-tipo-${valor}`;
  if (valor === "0") return "header-arquivo";
  if (valor === "9") return "trailer-arquivo";
  return `registro-tipo-${valor}`;
}

interface Classificacao {
  registro: string | null;
  referenciado: string | null;
  origem: "guarda" | "mensagem" | null;
}

function classificarRegistro(
  mensagem: string,
  guards: Guard[],
  alvo: string | null,
  familia: FamiliaLayout
): Classificacao {
  const daMensagem = inferirRegistrosDaMensagem(mensagem, familia);
  const daGuarda = inferirRegistroDaGuarda(guards, alvo, familia);

  // A guarda é o sinal estrutural e tem precedência sobre o texto — exceto quando
  // ela só sabe dizer "é um detalhe" e a mensagem nomeia o segmento exato.
  let registro = daGuarda ?? daMensagem[0] ?? null;
  let origem: "guarda" | "mensagem" | null = daGuarda ? "guarda" : daMensagem[0] ? "mensagem" : null;

  if (daGuarda === "detalhe") {
    const segmentoNaMensagem = daMensagem.find((r) => r.startsWith("segmento-"));
    if (segmentoNaMensagem) {
      registro = segmentoNaMensagem;
      origem = "mensagem";
    }
  }

  const referenciado = daMensagem.find((r) => r !== registro) ?? null;
  return { registro, referenciado, origem };
}

/**
 * Lê o tipo de registro das guardas dos `if` externos. Percorre da guarda mais
 * interna para a mais externa, porque a mais interna é a mais específica; guardas
 * negadas não identificam registro algum.
 */
function inferirRegistroDaGuarda(
  guards: Guard[],
  alvo: string | null,
  familia: FamiliaLayout
): string | null {
  const posSegmento = POSICAO_SEGMENTO[familia];
  const posTipo = POSICAO_TIPO_REGISTRO[familia];

  let tipo: string | null = null;

  for (let i = guards.length - 1; i >= 0; i--) {
    const guard = guards[i];
    if (guard.negada) continue;

    const comparacoes = igualdadesSobreSubstring(guard.test, false).filter(
      (c) => alvo === null || c.alvo === alvo
    );

    if (posSegmento) {
      const segmento = valorUnico(comparacoes, posSegmento);
      if (segmento && /^[A-Za-z]$/.test(segmento)) {
        return `segmento-${segmento.toLowerCase()}`;
      }
    }

    if (tipo === null) {
      const valor = valorUnico(comparacoes, posTipo);
      if (valor !== null && /^\d$/.test(valor)) {
        tipo = tipoRegistroPorFamilia(valor, familia);
      }
    }
  }

  return tipo;
}

interface Igualdade {
  alvo: string;
  inicio0: number;
  fim0: number;
  valor: string;
}

/** Valor comparado numa posição, ou null quando a guarda testa vários valores para ela. */
function valorUnico(
  comparacoes: Igualdade[],
  posicao: [number, number]
): string | null {
  const valores = new Set(
    comparacoes
      .filter((c) => c.inicio0 === posicao[0] && c.fim0 === posicao[1])
      .map((c) => c.valor)
  );
  return valores.size === 1 ? [...valores][0] : null;
}

/**
 * Coleta comparações `res[x].substring(a, b) == <literal>` dentro de um nó.
 *
 * Desce manualmente em vez de usar `simple` porque uma igualdade sob `!` afirma o
 * contrário do que aparenta: `!(res[i].substring(13, 14) == "P")` não identifica
 * o segmento P, identifica todo o resto.
 */
function igualdadesSobreSubstring(node: Node, negado: boolean = false): Igualdade[] {
  const encontradas: Igualdade[] = [];
  coletarIgualdades(node, negado, encontradas);
  return encontradas;
}

function coletarIgualdades(node: Node, negado: boolean, acc: Igualdade[]): void {
  switch (node.type) {
    case "LogicalExpression": {
      const logica = node as LogicalExpression;
      coletarIgualdades(logica.left, negado, acc);
      coletarIgualdades(logica.right, negado, acc);
      return;
    }
    case "UnaryExpression": {
      const unaria = node as UnaryExpression;
      if (unaria.operator === "!") {
        coletarIgualdades(unaria.argument, !negado, acc);
      }
      return;
    }
    case "BinaryExpression": {
      if (negado) return;
      const bin = node as BinaryExpression;
      if (bin.operator !== "==" && bin.operator !== "===") return;

      const lados: [Node, Node][] = [
        [bin.left, bin.right],
        [bin.right, bin.left],
      ];

      for (const [ladoChamada, ladoValor] of lados) {
        const sub = lerSubstring(ladoChamada);
        if (!sub || !isLiteral(ladoValor)) continue;
        const valor = ladoValor.value;
        if (typeof valor !== "string" && typeof valor !== "number") continue;
        acc.push({ ...sub, valor: String(valor) });
        return;
      }
      return;
    }
    default:
      return;
  }
}

/**
 * Mesma leitura de registro, a partir do texto da guarda já serializado no spec.
 * Existe para que o gate de propriedade possa auditar os specs versionados sem
 * reimplementar a regra de classificação.
 */
export function registroDaGuardaSource(
  condicaoGuarda: string,
  alvo: string | null,
  familia: FamiliaLayout = "cnab240"
): string | null {
  let expressao: Expression;
  try {
    const programa = parse(`(${condicaoGuarda})`, { ecmaVersion: "latest" });
    const primeiro = programa.body[0];
    if (!primeiro || primeiro.type !== "ExpressionStatement") return null;
    expressao = primeiro.expression;
  } catch {
    return null;
  }
  return inferirRegistroDaGuarda(
    [{ source: condicaoGuarda, test: expressao, negada: false }],
    alvo,
    familia
  );
}

function lerSubstring(
  node: Node
): { alvo: string; inicio0: number; fim0: number } | null {
  if (node.type !== "CallExpression") return null;
  const call = node as CallExpression;
  if (call.callee.type !== "MemberExpression") return null;

  const callee = call.callee as MemberExpression;
  const prop = callee.property;
  if (prop.type !== "Identifier" || (prop as Identifier).name !== "substring") return null;

  const alvo = nomeDoAlvo(callee.object);
  if (!alvo) return null;

  const [a, b] = call.arguments;
  if (!a || !b || !isLiteral(a) || !isLiteral(b)) return null;
  if (typeof a.value !== "number" || typeof b.value !== "number") return null;

  return { alvo, inicio0: a.value, fim0: b.value };
}

function nomeDoAlvo(node: Node): string | null {
  if (node.type !== "MemberExpression") return null;
  const member = node as MemberExpression;
  if (member.object.type !== "Identifier" || member.object.name !== "res") return null;

  const prop = member.property;
  if (isLiteral(prop)) return `res[${prop.value}]`;
  if (prop.type === "Identifier") {
    return member.computed ? `res[${prop.name}]` : `res.${prop.name}`;
  }
  return null;
}

const SINONIMOS_REGISTRO: Record<string, string[]> = {
  "header-arquivo": [
    "header de arquivo",
    "header do arquivo",
    "header arquivo",
    "cabeçalho de arquivo",
    "cabeçalho do arquivo",
  ],
  "header-lote": [
    "header de lote",
    "header do lote",
    "header lote",
    "cabeçalho de lote",
    "cabeçalho do lote",
  ],
  "segmento-a": ["segmento a", "segmento-a"],
  "segmento-b": ["segmento b", "segmento-b"],
  "segmento-j": ["segmento j", "segmento-j"],
  "segmento-j-52": ["segmento j-52", "segmento-j-52"],
  "segmento-n": ["segmento n", "segmento-n"],
  "segmento-o": ["segmento o", "segmento-o"],
  "segmento-p": ["segmento p", "segmento-p"],
  "segmento-q": ["segmento q", "segmento-q"],
  "segmento-r": ["segmento r", "segmento-r"],
  "segmento-s": ["segmento s", "segmento-s"],
  "segmento-w": ["segmento w", "segmento-w"],
  "segmento-y": ["segmento y", "segmento-y"],
  "trailer-lote": [
    "trailer de lote",
    "trailer do lote",
    "trailer lote",
    "segmento 5",
  ],
  "trailer-arquivo": [
    "trailer de arquivo",
    "trailer do arquivo",
    "trailer arquivo",
  ],
};

/**
 * Registros citados na mensagem, na ordem em que aparecem no texto.
 *
 * Ordena por posição e, no empate, pelo termo mais longo: sem isso "Segmento J-52"
 * é engolido por "segmento j", e "Header de lote divergente do Header de arquivo"
 * é classificado pelo registro errado — a mensagem cita dois, e o primeiro é o
 * registro validado; os demais são referências.
 */
function inferirRegistrosDaMensagem(
  mensagem: string,
  familia: FamiliaLayout
): string[] {
  const lower = mensagem.toLowerCase();
  const achados: { registro: string; inicio: number; fim: number }[] = [];

  for (const [registro, termos] of Object.entries(SINONIMOS_REGISTRO)) {
    for (const termo of termos) {
      const inicio = lower.indexOf(termo);
      if (inicio >= 0) {
        achados.push({ registro, inicio, fim: inicio + termo.length });
      }
    }
  }

  // No CNAB 400/200 o fonte nomeia o registro pelo código ("Registro tipo 1").
  if (familia !== "cnab240") {
    const tipoRegex = /registro\s+tipo\s+(\d)/gi;
    for (const m of mensagem.matchAll(tipoRegex)) {
      const inicio = m.index ?? 0;
      achados.push({
        registro: tipoRegistroPorFamilia(m[1], familia),
        inicio,
        fim: inicio + m[0].length,
      });
    }
  }

  achados.sort((a, b) => a.inicio - b.inicio || b.fim - a.fim);

  const resultado: string[] = [];
  let ultimoFim = -1;
  for (const achado of achados) {
    if (achado.inicio < ultimoFim) continue; // sobreposto por um termo mais específico
    if (!resultado.includes(achado.registro)) resultado.push(achado.registro);
    ultimoFim = achado.fim;
  }
  return resultado;
}

function extrairColunas(mensagem: string): [number, number] | null {
  const range = mensagem.match(/colunas?\s+(\d+)\s+a\s+(\d+)/i);
  if (range) {
    return [parseInt(range[1], 10), parseInt(range[2], 10)];
  }
  const hyphen = mensagem.match(/colunas?\s+(\d+)\s*[-–—]\s*(\d+)/i);
  if (hyphen) {
    return [parseInt(hyphen[1], 10), parseInt(hyphen[2], 10)];
  }
  const single = mensagem.match(/coluna\s+(\d+)/i);
  if (single) {
    const n = parseInt(single[1], 10);
    return [n, n];
  }
  return null;
}

function findResMembers(test: Node): string[] {
  const targets: string[] = [];

  simple(test, {
    MemberExpression(node: MemberExpression) {
      if (node.object.type !== "Identifier" || node.object.name !== "res") {
        return;
      }

      const prop = node.property;
      if (isLiteral(prop)) {
        targets.push(`res[${prop.value}]`);
      } else if (prop.type === "Identifier") {
        targets.push(node.computed ? `res[${prop.name}]` : `res.${prop.name}`);
      }
    },
  });

  return targets;
}
