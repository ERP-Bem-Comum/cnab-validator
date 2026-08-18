import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import type { RawRule } from "../src/ast-walker.js";
import { extractRulesFromFunction } from "../src/ast-walker.js";
import { mapToDsl } from "../src/rule-mapper.js";

const fixture = readFileSync(
  new URL("./fixtures/sample-condicoes.js", import.meta.url),
  "utf-8"
);

describe("mapToDsl", () => {
  it("classifica todos os arquetipos", () => {
    const raw = extractRulesFromFunction(fixture, "amostra");
    const rules = raw.map((r) => mapToDsl(r, "cobranca-remessa"));
    assert.strictEqual(rules[0].condicao.tipo, "literal_fixo");
    assert.strictEqual(rules[1].condicao.tipo, "numerico_branco");
    assert.strictEqual(rules[2].condicao.tipo, "dominio");
    assert.strictEqual(rules[3].condicao.tipo, "modulo_11");
    assert.strictEqual(rules[4].condicao.tipo, "coerencia_registro");
  });

  it("cai em custom quando nenhum arquetipo bate", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 999,
      condicao_original: 'res[0].substring(1, 3) == funcaoEstranha(res[0])',
      mensagem: "Condicao custom invalida.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "custom");
    assert.strictEqual(dsl.condicao.alvo, "res[0]");
  });

  it("nao classifica cadeia de literais fixos com posicoes diferentes como dominio", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 998,
      condicao_original:
        'res[0].substring(1, 3) != "AB" && res[0].substring(4, 6) != "CD"',
      mensagem: "Cadeia de literais invalida.",
      registro: null,
      colunas: [1, 6],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "custom");
  });

  it("nao classifica modulo_11 quando posicoes do comparado e do calculo nao batem", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 997,
      condicao_original:
        'res[0].substring(13, 27) != calcularModulo11(res[0].substring(0, 9))',
      mensagem: "Modulo 11 invalido.",
      registro: null,
      colunas: [13, 27],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "custom");
  });

  it("lida com colunas nulas usando defaults", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 996,
      condicao_original: 'res[0].substring(1, 3) != "XX"',
      mensagem: "Mensagem de teste colunas 5 a 10.",
      registro: null,
      colunas: null,
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.deepStrictEqual(dsl.colunas, [0, 0]);
    assert.strictEqual(dsl.posicoes[0].inicio0, 0);
    assert.strictEqual(dsl.posicoes[0].fim0, 1);
    assert.strictEqual(dsl.posicoes[0].tamanho, 1);
  });

  it("classifica dominio com && sem espacos", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 995,
      condicao_original:
        'res[0].substring(1,3)!="A"&&res[0].substring(1,3)!="B"',
      mensagem: "Dominio sem espacos.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    assert.deepStrictEqual((dsl.condicao as any).valores, ["A", "B"]);
  });

  it("classifica dominio com espacos extras em torno de &&", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 994,
      condicao_original:
        'res[0].substring(1, 3) != "A"   &&   res[0].substring(1, 3) != "B"',
      mensagem: "Dominio com espacos extras.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    assert.deepStrictEqual((dsl.condicao as any).valores, ["A", "B"]);
  });

  it("classifica dominio com clausulas entre parenteses", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 993,
      condicao_original:
        '(res[0].substring(1, 3) != "A") && (res[0].substring(1, 3) != "B")',
      mensagem: "Dominio com parenteses.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    assert.deepStrictEqual((dsl.condicao as any).valores, ["A", "B"]);
  });

  it("classifica literal_fixo com !==", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 992,
      condicao_original: 'res[0].substring(1, 3) !== "XX"',
      mensagem: "Literal fixo com !==.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "literal_fixo");
    assert.strictEqual((dsl.condicao as any).operador, "!==");
  });
});
