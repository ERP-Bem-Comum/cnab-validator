import { parse } from "acorn";
import { simple } from "acorn-walk";
import type {
  AnonymousFunctionDeclaration,
  FunctionDeclaration,
  VariableDeclaration,
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
    VariableDeclaration(node: VariableDeclaration) {
      // Armazena a declaração completa (ex: const foo = () => {...}) para que
      // extractRulesFromFunction possa localizar o declarador pelo nome e obter
      // o corpo da função. Usar só o lado direito da atribuição quebraria a
      // identificação por nome e a sintaxe de arrow/anonymous functions.
      for (const decl of node.declarations) {
        if (
          decl.id?.type === "Identifier" &&
          decl.id.name &&
          decl.init &&
          (decl.init.type === "FunctionExpression" ||
            decl.init.type === "ArrowFunctionExpression")
        ) {
          functions.set(decl.id.name, code.slice(node.start, node.end));
        }
      }
    },
  });

  return functions;
}
