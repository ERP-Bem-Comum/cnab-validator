import { parse } from "acorn";
import { simple } from "acorn-walk";
import type {
  Node,
  Statement,
  FunctionDeclaration,
  AnonymousFunctionDeclaration,
  FunctionExpression,
  ArrowFunctionExpression,
  BlockStatement,
  BinaryExpression,
  Literal,
  MemberExpression,
  Identifier,
  VariableDeclarator,
} from "acorn";

export interface RawRule {
  funcao_origem: string;
  linha_fonte: number;
  condicao_original: string;
  mensagem: string;
  registro: string | null;
  colunas: [number, number] | null;
  alvo: string | null;
}

export function extractRulesFromFunction(
  code: string,
  functionName: string,
  lineOffset: number = 0
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
    for (const stmt of targetBody.body) {
      visitStatement(stmt, code, functionName, rules, lineOffset, []);
    }
  }

  return rules;
}

function visitStatement(
  stmt: Statement,
  code: string,
  functionName: string,
  rules: RawRule[],
  lineOffset: number,
  guards: string[] = []
): void {
  switch (stmt.type) {
    case "IfStatement": {
      const testSource = code.slice(stmt.test.start, stmt.test.end);
      const targets = findResMembers(stmt.test);
      const message = extractConcatenatedMessage(stmt.consequent, code);
      if (message && !isNoise(message)) {
        rules.push({
          funcao_origem: functionName,
          linha_fonte: (stmt.loc?.start.line ?? 0) + lineOffset,
          condicao_original: combineTests(testSource, guards),
          mensagem: message,
          registro: inferirRegistro(message),
          colunas: extrairColunas(message),
          alvo: targets[0] ?? null,
        });
      }

      visitWithGuard(stmt.consequent, code, functionName, rules, lineOffset, guards, testSource);

      if (stmt.alternate) {
        const negated = `!(${testSource})`;
        if (stmt.alternate.type === "IfStatement") {
          visitStatement(stmt.alternate, code, functionName, rules, lineOffset, [...guards, negated]);
        } else if (
          stmt.alternate.type === "BlockStatement" ||
          stmt.alternate.type === "ExpressionStatement"
        ) {
          const altMessage = extractConcatenatedMessage(stmt.alternate, code);
          if (altMessage && !isNoise(altMessage)) {
            rules.push({
              funcao_origem: functionName,
              linha_fonte: (stmt.alternate.loc?.start.line ?? 0) + lineOffset,
              condicao_original: combineTests(negated, guards),
              mensagem: altMessage,
              registro: inferirRegistro(altMessage),
              colunas: extrairColunas(altMessage),
              alvo: targets[0] ?? null,
            });
          }
          visitWithGuard(stmt.alternate, code, functionName, rules, lineOffset, guards, negated);
        } else {
          visitStatement(stmt.alternate, code, functionName, rules, lineOffset, [...guards, negated]);
        }
      }
      break;
    }
    case "ForStatement":
    case "WhileStatement": {
      const body = stmt.body;
      if (body.type === "BlockStatement") {
        visitBlock(body, code, functionName, rules, lineOffset, guards);
      }
      break;
    }
    case "BlockStatement": {
      visitBlock(stmt, code, functionName, rules, lineOffset, guards);
      break;
    }
  }
}

function visitWithGuard(
  stmt: Statement,
  code: string,
  functionName: string,
  rules: RawRule[],
  lineOffset: number,
  guards: string[],
  guard: string
): void {
  if (stmt.type === "BlockStatement") {
    visitBlock(stmt, code, functionName, rules, lineOffset, [...guards, guard]);
  } else {
    visitStatement(stmt, code, functionName, rules, lineOffset, [...guards, guard]);
  }
}

function combineTests(test: string, guards: string[]): string {
  if (guards.length === 0) return test;
  const all = [...guards, test];
  return all.map((g) => `(${g})`).join(" && ");
}

function isNoise(message: string): boolean {
  const normalized = message.toLowerCase();
  if (normalized.includes("foi validado") || normalized.includes("não necessita de ajustes")) {
    return true;
  }
  const indicator = /(inválid|invalid|falhou|falha|erro|incorret|divergent|obrigatório|obrigatorio|deixar em branco|informar|zerad|ausente|reprovad|não|exclusivo|apenas|somente|obrigado)/i;
  return !indicator.test(message);
}

function visitBlock(
  block: BlockStatement,
  code: string,
  functionName: string,
  rules: RawRule[],
  lineOffset: number,
  guards: string[] = []
): void {
  for (const inner of block.body) {
    visitStatement(inner, code, functionName, rules, lineOffset, guards);
  }
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
    const right = stmt.expression.right;
    if (isLiteralString(right)) {
      return right.value;
    }
    if (isAddExpression(right)) {
      return extractStringFromExpression(right, code);
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

function extractStringFromExpression(expr: Node, code: string): string {
  if (isLiteralString(expr)) {
    return expr.value;
  }
  if (isAddExpression(expr)) {
    return (
      extractStringFromExpression(expr.left, code) +
      extractStringFromExpression(expr.right, code)
    );
  }
  return "";
}

function inferirRegistro(mensagem: string): string | null {
  const lower = mensagem.toLowerCase();
  const synonyms: Record<string, string[]> = {
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
    "segmento-w": ["segmento w", "segmento-w"],
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

  for (const [registro, terms] of Object.entries(synonyms)) {
    if (terms.some((term) => lower.includes(term))) {
      return registro;
    }
  }

  return null;
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
