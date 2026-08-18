import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extractRulesFromFunction } from "../src/ast-walker.js";

const fixture = readFileSync(
  new URL("./fixtures/sample-cobranca.js", import.meta.url),
  "utf-8"
);

describe("extractRulesFromFunction", () => {
  it("extracts three structural rules", () => {
    const rules = extractRulesFromFunction(fixture, "validarDadosArquivo240");
    assert.strictEqual(rules.length, 3);
    assert.strictEqual(rules[0].registro, "header-arquivo");
    assert.strictEqual(rules[0].condicao_original, 'res[0].substring(3, 7) != "0000"');
    assert.deepStrictEqual(rules[1].colunas, [143, 143]);
    assert.strictEqual(rules[2].registro, "segmento-p");
  });
});
