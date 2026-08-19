import { describe, it, expect } from "bun:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  downloadText,
  parseScripts,
  extractScriptUrls,
  extractInlineScripts,
  saveAsset,
} from "../src/downloader.js";
import { extractNamedFunctions } from "../src/inline-parser.js";
import { extractRulesFromFunction } from "../src/ast-walker.js";
import { mapToDsl, extrairPosicoesDaCondicao } from "../src/rule-mapper.js";
import { writeSpecs } from "../src/spec-generator.js";

describe("bootstrap smoke test", () => {
  it("carrega todos os módulos principais sem erro", () => {
    expect(typeof downloadText).toBe("function");
    expect(typeof parseScripts).toBe("function");
    expect(typeof extractScriptUrls).toBe("function");
    expect(typeof extractInlineScripts).toBe("function");
    expect(typeof saveAsset).toBe("function");
    expect(typeof extractNamedFunctions).toBe("function");
    expect(typeof extractRulesFromFunction).toBe("function");
    expect(typeof mapToDsl).toBe("function");
    expect(typeof extrairPosicoesDaCondicao).toBe("function");
    expect(typeof writeSpecs).toBe("function");
  });

  it("parseScripts extrai scripts inline e externos", () => {
    const html = `
      <html>
        <head><script src="/app.js"></script></head>
        <body><script>var x = 1;</script></body>
      </html>
    `;
    const result = parseScripts(html);
    expect(result.urls).toEqual(["/app.js"]);
    expect(result.inline).toEqual([{ code: "var x = 1;", lineOffset: 3 }]);
  });

  it("extractNamedFunctions encontra funções nomeadas", () => {
    const code = "function foo() { return 1; }\nconst bar = () => 2;";
    const fns = extractNamedFunctions(code);
    expect(fns.has("foo")).toBe(true);
    expect(fns.has("bar")).toBe(true);
  });

  it("extractRulesFromFunction extrai regra de condição literal", () => {
    const code = `function validarTeste(res) {
      if (res[0].substring(0, 3) != "237") {
        mensagem = "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.";
      }
    }`;
    const rules = extractRulesFromFunction(code, "validarTeste");
    expect(rules.length).toBe(1);
    expect(rules[0].funcao_origem).toBe("validarTeste");
    expect(rules[0].mensagem).toContain("código do banco inválido");
    expect(rules[0].colunas).toEqual([1, 3]);
  });

  it("mapToDsl converte regra bruta em DSL", () => {
    const raw = {
      funcao_origem: "validarTeste",
      linha_fonte: 2,
      condicao_original: 'res[0].substring(0, 3) != "237"',
      mensagem: "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.",
      registro: "header-arquivo",
      colunas: [1, 3] as [number, number],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    expect(dsl.id).toBe("cobranca-remessa:validarTeste:2");
    expect(dsl.condicao.tipo).toBe("literal_fixo");
    expect(dsl.colunas).toEqual([1, 3]);
  });

  it("extrairPosicoesDaCondicao interpreta substring", () => {
    const pos = extrairPosicoesDaCondicao('res[0].substring(3, 7) != "0000"');
    expect(pos).toEqual({ inicio0: 3, fim0: 7 });
  });
});

describe("baselines versionados", () => {
  it("são dois arquivos distintos, com propósitos distintos", () => {
    // O gate de reprodutibilidade compara o corpus de fixture; o monitor de
    // mudança compara o corpus do banco. Um só arquivo faria o aviso do monitor
    // disparar em toda execução — e alerta que sempre toca não é alerta.
    const fixture = JSON.parse(
      readFileSync(new URL("../baseline.json", import.meta.url), "utf-8")
    );
    const corpus = JSON.parse(
      readFileSync(new URL("../baseline-corpus.json", import.meta.url), "utf-8")
    );

    assert.match(fixture.sha256, /^[0-9a-f]{64}$/);
    assert.match(corpus.sha256, /^[0-9a-f]{64}$/);
    assert.notStrictEqual(fixture.sha256, corpus.sha256);
    assert.ok(corpus.fontes.length > 0, "o baseline do corpus registra de onde ele veio");
    assert.ok(corpus.capturado_em, "a data da captura diz o quão velho o baseline está");
  });

  it("o baseline de fixture acompanha o corpus de fixture", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../baseline.json", import.meta.url), "utf-8")
    );
    const corpus = readFileSync(
      new URL("./fixtures/corpus-fixture.js", import.meta.url),
      "utf-8"
    );
    const hash = createHash("sha256").update(corpus).digest("hex");
    assert.strictEqual(
      fixture.sha256,
      hash,
      "baseline.json desatualizado: regenere o hash do corpus de fixture"
    );
  });
});
