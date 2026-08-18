import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extractRulesFromFunction } from "../src/ast-walker.js";

const fixture = readFileSync(
  new URL("./fixtures/sample-cobranca.js", import.meta.url),
  "utf-8"
);

describe("extractRulesFromFunction", () => {
  it("extracts rules from a function declaration", () => {
    const rules = extractRulesFromFunction(fixture, "validarDadosArquivo240");
    assert.strictEqual(rules.length, 3);
    assert.strictEqual(rules[0].registro, "header-arquivo");
    assert.strictEqual(rules[0].condicao_original, 'res[0].substring(3, 7) != "0000"');
    assert.deepStrictEqual(rules[0].colunas, [4, 7]);
    assert.strictEqual(rules[0].alvo, "res[0]");
    assert.deepStrictEqual(rules[1].colunas, [143, 143]);
    assert.strictEqual(rules[2].registro, "segmento-p");
    assert.strictEqual(rules[2].alvo, "res[i]");
  });

  it("extracts rules from a function expression", () => {
    const rules = extractRulesFromFunction(fixture, "validarComoExpressao");
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].registro, "header-lote");
    assert.deepStrictEqual(rules[0].colunas, [1, 3]);
    assert.strictEqual(rules[0].alvo, "res[1]");
    assert.strictEqual(rules[0].condicao_original, 'res[1].substring(0, 3) != "077"');
    assert.strictEqual(rules[1].registro, "header-lote");
    assert.strictEqual(rules[1].condicao_original, '!(res[1].substring(0, 3) != "077")');
  });

  it("extracts rules from an arrow function", () => {
    const rules = extractRulesFromFunction(fixture, "validarComoArrow");
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].registro, "segmento-q");
    assert.deepStrictEqual(rules[0].colunas, [4, 7]);
    assert.deepStrictEqual(rules[0].alvo, "res[2]");
    assert.strictEqual(rules[1].mensagem, "Aviso genérico sem colunas.<br>");
    assert.strictEqual(rules[1].colunas, null);
    assert.strictEqual(rules[1].registro, null);
  });

  it("handles else branches and single column ranges", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0] === "x") {
          str += "Header do arquivo, coluna 001, ok.<br>";
        } else {
          str += "Header do arquivo, coluna 001, falhou.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 2);
    assert.deepStrictEqual(rules[0].colunas, [1, 1]);
    assert.deepStrictEqual(rules[1].colunas, [1, 1]);
    assert.strictEqual(rules[0].registro, "header-arquivo");
    assert.strictEqual(rules[1].registro, "header-arquivo");
  });

  it("handles multi-res conditions", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0].x != "a" && res[1].y != "b") {
          str += "Segmento R, colunas 001-003, erro.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].alvo, "res[0]");
  });

  it("returns null for unclassified registers and invalid columns", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0] === "x") {
          str += "Registro não identificado.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].registro, null);
    assert.strictEqual(rules[0].colunas, null);
    assert.strictEqual(rules[0].alvo, "res[0]");
  });

  it("tolerates uppercase and lowercase register synonyms", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0] === "x") {
          str += "HEADER DE ARQUIVO, colunas 001 a 005, erro.<br>";
        }
        if (res[0] === "y") {
          str += "header do arquivo, colunas 001 a 005, erro.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].registro, "header-arquivo");
    assert.strictEqual(rules[1].registro, "header-arquivo");
  });

  it("returns empty array when function is not found", () => {
    const rules = extractRulesFromFunction(fixture, "naoExiste");
    assert.deepStrictEqual(rules, []);
  });
});
