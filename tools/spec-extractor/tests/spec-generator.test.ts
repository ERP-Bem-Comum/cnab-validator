import { describe, it } from "bun:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSpecs } from "../src/spec-generator.js";
import type { DslRule } from "../src/rule-mapper.js";

describe("writeSpecs", () => {
  it("writes index.json and layout files", () => {
    const dir = mkdtempSync(join(tmpdir(), "specs-"));
    const rule: DslRule = {
      id: "cobranca-remessa:117",
      funcao_origem: "validarDadosArquivo240",
      linha_fonte: 117,
      registro: "header-arquivo",
      registro_alvo: ["res[0]"],
      colunas: [4, 7],
      posicoes: [{ alvo: "res[0]", inicio0: 3, fim0: 7, colunas: [4, 7], tamanho: 4 }],
      condicao: { tipo: "literal_fixo", alvo: "res[0]", posicao: { inicio0: 3, fim0: 7 }, operador: "!=", valor: "0000" },
      condicao_original: 'res[0].substring(3, 7) != "0000"',
      descricao: "Header de arquivo, não contém número de lote 0000.",
      mensagem: "Linha 1, colunas 004 a 007, Header de arquivo, não contém número de lote 0000.",
      natureza: "validacao-estrutural",
      severidade: "erro",
    };

    writeSpecs(dir, { "cobranca-remessa": [rule] });

    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
    assert.strictEqual(index.total_regras, 1);
    assert.strictEqual(index.layouts[0].layout, "cobranca-remessa");

    const layout = JSON.parse(readFileSync(join(dir, "layouts", "cobranca-remessa.json"), "utf-8"));
    assert.strictEqual(layout.regras.length, 1);

    rmSync(dir, { recursive: true, force: true });
  });
});
