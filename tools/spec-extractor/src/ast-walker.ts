import { parse } from "acorn";
import { simple } from "acorn-walk";
import type {
  Node,
  Statement,
  FunctionDeclaration,
  AnonymousFunctionDeclaration,
  BlockStatement,
  BinaryExpression,
  Literal,
  MemberExpression,
  Identifier,
} from "acorn";

export interface RawRule {
  funcao_origem: string;
  linha_fonte: number;
  condicao_original: string;
  mensagem: string;
  registro: string;
  colunas: [number, number];
  alvo: string;
}

export function extractRulesFromFunction(
  code: string,
  functionName: string
): RawRule[] {
  const ast = parse(code, { ecmaVersion: "latest", locations: true });
  const rules: RawRule[] = [];

  simple(ast, {
    FunctionDeclaration(node: FunctionDeclaration | AnonymousFunctionDeclaration) {
      if (node.id?.name !== functionName) return;
      if (node.body.type !== "BlockStatement") return;
      for (const stmt of node.body.body) {
        visitStatement(stmt, code, functionName, rules);
      }
    },
  });

  return rules;
}

function visitStatement(
  stmt: Statement,
  code: string,
  functionName: string,
  rules: RawRule[]
): void {
  switch (stmt.type) {
    case "IfStatement": {
      const message = extractConcatenatedMessage(stmt.consequent, code);
      if (message) {
        rules.push({
          funcao_origem: functionName,
          linha_fonte: stmt.loc?.start.line ?? 0,
          condicao_original: code.slice(stmt.test.start, stmt.test.end),
          mensagem: message,
          registro: inferirRegistro(message),
          colunas: extrairColunas(message),
          alvo: extrairAlvo(stmt.test),
        });
      }
      if (stmt.alternate) {
        visitStatement(stmt.alternate, code, functionName, rules);
      }
      break;
    }
    case "ForStatement":
    case "WhileStatement": {
      const body = stmt.body;
      if (body.type === "BlockStatement") {
        visitBlock(body, code, functionName, rules);
      }
      break;
    }
    case "BlockStatement": {
      visitBlock(stmt, code, functionName, rules);
      break;
    }
  }
}

function visitBlock(
  block: BlockStatement,
  code: string,
  functionName: string,
  rules: RawRule[]
): void {
  for (const inner of block.body) {
    visitStatement(inner, code, functionName, rules);
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

function isLiteralString(node: Node): node is Literal & { value: string } {
  return node.type === "Literal" && typeof (node as Literal).value === "string";
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

function inferirRegistro(mensagem: string): string {
  const lower = mensagem.toLowerCase();
  if (lower.includes("header de arquivo")) return "header-arquivo";
  if (lower.includes("header de lote")) return "header-lote";
  if (lower.includes("segmento p")) return "segmento-p";
  if (lower.includes("segmento q")) return "segmento-q";
  if (lower.includes("segmento r")) return "segmento-r";
  if (lower.includes("trailer de lote")) return "trailer-lote";
  if (lower.includes("trailer de arquivo")) return "trailer-arquivo";
  return "nao-classificado";
}

function extrairColunas(mensagem: string): [number, number] {
  const match = mensagem.match(/colunas?\s+(\d+)\s+a\s+(\d+)/i);
  if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
  const single = mensagem.match(/coluna\s+(\d+)/i);
  if (single) {
    const n = parseInt(single[1], 10);
    return [n, n];
  }
  return [0, 0];
}

function extrairAlvo(test: Node): string {
  const found = findResMember(test);
  return found ?? "res[0]";
}

function isIdentifier(node: Node): node is Identifier {
  return node.type === "Identifier";
}

function isMemberExpression(node: Node): node is MemberExpression {
  return node.type === "MemberExpression";
}

function findResMember(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;

  const n = node as Node;
  if (isMemberExpression(n)) {
    const obj = n.object;
    if (isIdentifier(obj) && obj.name === "res") {
      const prop = n.property;
      if (isLiteralString(prop)) {
        return `res[${prop.value}]`;
      }
      if (isIdentifier(prop)) {
        return `res.${prop.name}`;
      }
      return "res[?]";
    }
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = findResMember(item);
        if (result) return result;
      }
    } else if (value && typeof value === "object" && "type" in value) {
      const result = findResMember(value);
      if (result) return result;
    }
  }

  return null;
}
