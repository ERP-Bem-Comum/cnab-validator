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
    assert.strictEqual(functions.get("helper"), `function(x) { return x; }`);
    assert.strictEqual(functions.get("mapper"), `function(y) { return y * 2; }`);
    assert.strictEqual(functions.get("reducer"), `function(z) { return z - 1; }`);
  });

  it("extracts arrow functions", () => {
    const code = `
      const add = (a, b) => a + b;
      const square = n => n * n;
      const block = () => { return 1; };
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(functions.get("add"), `(a, b) => a + b`);
    assert.strictEqual(functions.get("square"), `n => n * n`);
    assert.strictEqual(functions.get("block"), `() => { return 1; }`);
  });

  it("handles multiple declarators in one declaration", () => {
    const code = `
      const a = function(x) { return x; }, b = (y) => y + 1, c = 42;
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(functions.get("a"), `function(x) { return x; }`);
    assert.strictEqual(functions.get("b"), `(y) => y + 1`);
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
});
