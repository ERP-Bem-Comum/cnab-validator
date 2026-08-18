import { parse } from "acorn";
import { simple } from "acorn-walk";

export function extractNamedFunctions(code: string): Map<string, string> {
  const ast = parse(code, { ecmaVersion: "latest" });
  const functions = new Map<string, string>();

  simple(ast, {
    FunctionDeclaration(node: any) {
      if (node.id && node.id.name) {
        functions.set(node.id.name, code.slice(node.start, node.end));
      }
    },
    VariableDeclarator(node: any) {
      if (
        node.id &&
        node.id.name &&
        node.init &&
        ["FunctionExpression", "ArrowFunctionExpression"].includes(node.init.type)
      ) {
        functions.set(node.id.name, code.slice(node.init.start, node.init.end));
      }
    },
  });

  return functions;
}
