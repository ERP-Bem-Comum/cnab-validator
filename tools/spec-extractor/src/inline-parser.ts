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
      // Quando há múltiplos declaradores, armazena a declaração completa para
      // preservar a referência de linha do keyword const/let/var. Com apenas um
      // declarador, isola-o para evitar duplicar source desnecessariamente.
      const hasMultipleDeclarators = node.declarations.length > 1;
      const fullDeclaration = hasMultipleDeclarators
        ? code.slice(node.start, node.end)
        : null;

      for (const decl of node.declarations) {
        if (
          decl.id?.type === "Identifier" &&
          decl.id.name &&
          decl.init &&
          (decl.init.type === "FunctionExpression" ||
            decl.init.type === "ArrowFunctionExpression")
        ) {
          if (fullDeclaration) {
            functions.set(decl.id.name, fullDeclaration);
          } else {
            const declaratorSource = code.slice(decl.start, decl.end).trim();
            functions.set(decl.id.name, `${node.kind} ${declaratorSource};`);
          }
        }
      }
    },
  });

  return functions;
}
