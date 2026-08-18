import { describe, it } from "bun:test";
import assert from "node:assert";
import { extractNamedFunctions } from "../src/inline-parser.js";

describe("extractNamedFunctions", () => {
  it("extracts function declarations", () => {
    const code = `function obterValorCNPJAlfanumerico(v) { return v.trim(); }`;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(functions.get("obterValorCNPJAlfanumerico"), code);
  });

  it("extracts var, let and const function expressions", () => {
    const code = `
      var helper = function(x) { return x; };
      let mapper = function(y) { return y * 2; };
      const reducer = function(z) { return z - 1; };
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(
      functions.get("helper")?.trim(),
      "var helper = function(x) { return x; };"
    );
    assert.strictEqual(
      functions.get("mapper")?.trim(),
      "let mapper = function(y) { return y * 2; };"
    );
    assert.strictEqual(
      functions.get("reducer")?.trim(),
      "const reducer = function(z) { return z - 1; };"
    );
  });

  it("extracts arrow functions", () => {
    const code = `
      const add = (a, b) => a + b;
      const square = n => n * n;
      const block = () => { return 1; };
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(
      functions.get("add")?.trim(),
      "const add = (a, b) => a + b;"
    );
    assert.strictEqual(
      functions.get("square")?.trim(),
      "const square = n => n * n;"
    );
    assert.strictEqual(
      functions.get("block")?.trim(),
      "const block = () => { return 1; };"
    );
  });

  it("handles multiple declarators in one declaration", () => {
    const code = `
      const a = function(x) { return x; }, b = (y) => y + 1, c = 42;
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(
      functions.get("a")?.trim(),
      "const a = function(x) { return x; };"
    );
    assert.strictEqual(
      functions.get("b")?.trim(),
      "const b = (y) => y + 1;"
    );
    assert.strictEqual(functions.has("c"), false);
  });

  it("keeps the last declaration when duplicate names exist", () => {
    const code = `
      function dup(v) { return v; }
      function dup(v) { return v + 1; }
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(
      functions.get("dup"),
      `function dup(v) { return v + 1; }`
    );
  });

  it("ignores non-function variables", () => {
    const code = `
      const number = 123;
      let text = "hello";
      var object = { fn: function() {} };
      function realFn() {}
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(functions.has("number"), false);
    assert.strictEqual(functions.has("text"), false);
    assert.strictEqual(functions.has("object"), false);
    assert.strictEqual(functions.has("realFn"), true);
  });

  it("returns source that extractRulesFromFunction can parse", async () => {
    const code = `const validarInline = (res) => {
      if (res[0].substring(0, 3) != "237") {
        mensagem = "Linha 1, colunas 001 a 003, erro.";
      }
    };`;
    const functions = extractNamedFunctions(code);
    const source = functions.get("validarInline");
    assert.ok(source, "expected function source to be present");
    // Dynamic import avoids loading the walker at test-collection time.
    const { extractRulesFromFunction } = await import("../src/ast-walker.js");
    const rules = extractRulesFromFunction(source!, "validarInline");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].funcao_origem, "validarInline");
    assert.deepStrictEqual(rules[0].colunas, [1, 3]);
  });
});
