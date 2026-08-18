import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import type { RawRule } from "../src/ast-walker.js";
import { extractRulesFromFunction } from "../src/ast-walker.js";
import { extrairPosicoesDaCondicao, mapToDsl } from "../src/rule-mapper.js";

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

  it("lida com colunas nulas usando defaults quando condicao nao tem substring", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 996,
      condicao_original: "res[0].length != 240",
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

  it("extrai colunas da condicao em vez da mensagem", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 996,
      condicao_original: 'res[0].substring(10, 15) != "XXXXX"',
      mensagem: "Mensagem com colunas 5 a 10.",
      registro: null,
      colunas: [5, 10],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.deepStrictEqual(dsl.colunas, [11, 15]);
    assert.strictEqual(dsl.posicoes[0].inicio0, 10);
    assert.strictEqual(dsl.posicoes[0].fim0, 15);
    assert.strictEqual(dsl.posicoes[0].tamanho, 5);
  });

  it("corrige colunas invertidas e emite aviso", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 996,
      condicao_original: 'res[0].substring(15, 10) != "XXXXX"',
      mensagem: "Mensagem com colunas invertidas.",
      registro: null,
      colunas: [16, 10],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.posicoes[0].inicio0, 10);
    assert.strictEqual(dsl.posicoes[0].fim0, 15);
    assert.strictEqual(dsl.posicoes[0].tamanho, 5);
  });

  it("gera id no formato layout:funcao:linha", () => {
    const raw: RawRule = {
      funcao_origem: "validarDadosArquivo240",
      linha_fonte: 42,
      condicao_original: 'res[0].substring(1, 3) != "XX"',
      mensagem: "Teste.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.id, "cobranca-remessa:validarDadosArquivo240:42");
  });

  it("extrai posicoes da condicao", () => {
    assert.deepStrictEqual(extrairPosicoesDaCondicao('res[0].substring(5, 9) != "X"'), {
      inicio0: 5,
      fim0: 9,
    });
    assert.strictEqual(extrairPosicoesDaCondicao("res[0].length != 240"), null);
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

  it("classifica literal_fixo entre parenteses externos", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 991,
      condicao_original: '(res[0].substring(1, 3) !== "XX")',
      mensagem: "Literal fixo entre parenteses.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "literal_fixo");
    assert.strictEqual((dsl.condicao as any).operador, "!==");
    assert.strictEqual((dsl.condicao as any).valor, "XX");
  });

  it("classifica literal_fixo com literal numerico", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 990,
      condicao_original: "res[0].substring(1, 3) != 0",
      mensagem: "Literal numerico invalido.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "literal_fixo");
    assert.strictEqual((dsl.condicao as any).valor, "0");
  });

  it("classifica modulo_11 com variantes de nome de funcao", () => {
    for (const fn of ["modulo11", "calcModulo11", "calcularDigitoVerificador"]) {
      const raw: RawRule = {
        funcao_origem: "amostra",
        linha_fonte: 989,
        condicao_original: `res[0].substring(13, 27) != ${fn}(res[0].substring(13, 27))`,
        mensagem: "Modulo 11 invalido.",
        registro: null,
        colunas: [13, 27],
        alvo: "res[0]",
      };
      const dsl = mapToDsl(raw, "cobranca-remessa");
      assert.strictEqual(dsl.condicao.tipo, "modulo_11", `deveria reconhecer ${fn}`);
    }
  });
});
