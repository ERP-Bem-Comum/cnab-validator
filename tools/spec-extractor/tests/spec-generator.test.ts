import { describe, it } from "bun:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSpecs } from "../src/spec-generator.js";
import type { DslRule } from "../src/rule-mapper.js";

function makeRule(layout: string, overrides: Partial<DslRule> = {}): DslRule {
  return {
    id: `${layout}:validarDadosArquivo240:117`,
    funcao_origem: "validarDadosArquivo240",
    linha_fonte: 117,
    registro: "header-arquivo",
    registro_referenciado: null,
    registro_origem: "mensagem",
    registro_alvo: ["res[0]"],
    colunas: [4, 7],
    colunas_mensagem: null,
    posicoes: [{ alvo: "res[0]", inicio0: 3, fim0: 7, colunas: [4, 7], tamanho: 4 }],
    condicao: {
      tipo: "literal_fixo",
      alvo: "res[0]",
      posicao: { inicio0: 3, fim0: 7 },
      operador: "!=",
      valor: "0000",
      comparacao: "estrita",
    },
    condicao_original: 'res[0].substring(3, 7) != "0000"',
    condicao_guarda: null,
    descricao: "Header de arquivo, não contém número de lote 0000.",
    mensagem: "Linha 1, colunas 004 a 007, Header de arquivo, não contém número de lote 0000.",
    natureza: "validacao-estrutural",
    severidade: "erro",
    ...overrides,
  };
}

describe("writeSpecs", () => {
  it("writes index.json and layout files", () => {
    const dir = mkdtempSync(join(tmpdir(), "specs-"));
    try {
      const rule = makeRule("cobranca-remessa");
      writeSpecs(dir, { "cobranca-remessa": [rule] });

      const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
      assert.strictEqual(index.total_regras, 1);
      assert.strictEqual(index.layouts[0].layout, "cobranca-remessa");

      const layout = JSON.parse(readFileSync(join(dir, "layouts", "cobranca-remessa.json"), "utf-8"));
      assert.strictEqual(layout.regras.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes multiple layouts", () => {
    const dir = mkdtempSync(join(tmpdir(), "specs-"));
    try {
      writeSpecs(dir, {
        "cobranca-remessa": [makeRule("cobranca-remessa")],
        multipag: [makeRule("multipag"), makeRule("multipag", { id: "multipag:validarDadosArquivo240:118", linha_fonte: 118 })],
        "folha-pagamento": [],
      });

      const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
      assert.strictEqual(index.total_regras, 3);
      assert.strictEqual(index.layouts.length, 3);

      const cobranca = JSON.parse(readFileSync(join(dir, "layouts", "cobranca-remessa.json"), "utf-8"));
      assert.strictEqual(cobranca.tipo, "remessa");
      assert.deepStrictEqual(cobranca.tamanhos_linha, [240, 400]);

      const multipag = JSON.parse(readFileSync(join(dir, "layouts", "multipag.json"), "utf-8"));
      assert.strictEqual(multipag.regras.length, 2);
      assert.deepStrictEqual(multipag.tamanhos_linha, [240]);

      const folha = JSON.parse(readFileSync(join(dir, "layouts", "folha-pagamento.json"), "utf-8"));
      assert.deepStrictEqual(folha.regras, []);
      assert.deepStrictEqual(folha.tamanhos_linha, [200, 240]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes empty rule set", () => {
    const dir = mkdtempSync(join(tmpdir(), "specs-"));
    try {
      writeSpecs(dir, { "cobranca-remessa": [] });

      const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
      assert.strictEqual(index.total_regras, 0);
      assert.strictEqual(index.layouts[0].total_regras, 0);

      const layout = JSON.parse(readFileSync(join(dir, "layouts", "cobranca-remessa.json"), "utf-8"));
      assert.deepStrictEqual(layout.regras, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws for unknown layout", () => {
    const dir = mkdtempSync(join(tmpdir(), "specs-"));
    try {
      assert.throws(
        () => writeSpecs(dir, { "desconhecido": [makeRule("desconhecido")] }),
        /Unknown layout: desconhecido/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws for invalid layout key", () => {
    const dir = mkdtempSync(join(tmpdir(), "specs-"));
    try {
      assert.throws(
        () => writeSpecs(dir, { "cobranca_remessa": [makeRule("cobranca_remessa")] }),
        /Invalid layout key: cobranca_remessa/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("populates sub_layouts, nome and tamanhos_linha", () => {
    const dir = mkdtempSync(join(tmpdir(), "specs-"));
    try {
      writeSpecs(dir, {
        "cobranca-remessa": [
          makeRule("cobranca-remessa", { funcao_origem: "validarDadosArquivo240" }),
          makeRule("cobranca-remessa", { funcao_origem: "validarDadosArquivo240", id: "cobranca-remessa:validarDadosArquivo240:118", linha_fonte: 118 }),
          makeRule("cobranca-remessa", { funcao_origem: "validarTrailerArquivo240", id: "cobranca-remessa:validarTrailerArquivo240:200", linha_fonte: 200 }),
        ],
      });

      const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
      const entry = index.layouts[0];
      assert.strictEqual(entry.nome, "Cobrança — Remessa");
      assert.deepStrictEqual(entry.tamanhos_linha, [240, 400]);
      assert.deepStrictEqual(entry.sub_layouts, [
        { funcao: "validarDadosArquivo240", regras: 2 },
        { funcao: "validarTrailerArquivo240", regras: 1 },
      ]);

      const layout = JSON.parse(readFileSync(join(dir, "layouts", "cobranca-remessa.json"), "utf-8"));
      assert.strictEqual(layout.nome, "Cobrança — Remessa");
      assert.deepStrictEqual(layout.tamanhos_linha, [240, 400]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
