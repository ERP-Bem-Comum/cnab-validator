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
      // Armazena cada declarador como uma declaração isolada (ex:
      // "const foo = () => {...};") para que extractRulesFromFunction possa
      // localizar o declarador pelo nome sem duplicar o source entre nomes
      // em uma mesma declaração com múltiplos declaradores.
      for (const decl of node.declarations) {
        if (
          decl.id?.type === "Identifier" &&
          decl.id.name &&
          decl.init &&
          (decl.init.type === "FunctionExpression" ||
            decl.init.type === "ArrowFunctionExpression")
        ) {
          const declaratorSource = code.slice(decl.start, decl.end).trim();
          functions.set(
            decl.id.name,
            `${node.kind} ${declaratorSource};`
          );
        }
      }
    },
  });

  return functions;
}
