import { parse } from "acorn";
import { simple } from "acorn-walk";
import type {
  AnonymousFunctionDeclaration,
  FunctionDeclaration,
  VariableDeclarator,
} from "acorn";

export function extractNamedFunctions(code: string): Map<string, string> {
  const ast = parse(code, { ecmaVersion: "latest" });
  const functions = new Map<string, string>();

  simple(ast, {
    FunctionDeclaration(node: FunctionDeclaration | AnonymousFunctionDeclaration) {
      if (node.id?.name) {
        functions.set(node.id.name, code.slice(node.start, node.end));
      }
    },
    VariableDeclarator(node: VariableDeclarator) {
      if (
        node.id?.type === "Identifier" &&
        node.id.name &&
        node.init &&
        (node.init.type === "FunctionExpression" || node.init.type === "ArrowFunctionExpression")
      ) {
        functions.set(node.id.name, code.slice(node.init.start, node.init.end));
      }
    },
  });

  return functions;
}
