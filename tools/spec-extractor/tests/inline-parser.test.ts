import { describe, it } from "bun:test";
import assert from "node:assert";
import { extractNamedFunctions } from "../src/inline-parser.js";

describe("extractNamedFunctions", () => {
  it("captures function declarations and assignments", () => {
    const code = `
      function obterValorCNPJAlfanumerico(v) { return v.trim(); }
      var helper = function(x) { return x; };
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(functions.has("obterValorCNPJAlfanumerico"), true);
    assert.strictEqual(functions.get("obterValorCNPJAlfanumerico")?.includes("trim"), true);
  });
});
