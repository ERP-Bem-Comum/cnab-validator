import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { gerarParidade } from "../src/paridade.js";

/**
 * Os relatórios de `tools/paridade/` são o oráculo do motor Rust. Se o runner
 * mudar e eles não forem regerados, o `cnab-core` passa a ser medido contra um
 * comportamento que não existe mais — e o teste de paridade dele viraria teatro.
 * Este teste é o que impede isso.
 */
describe("relatórios de paridade", () => {
  const relatorios = gerarParidade("multipag");

  it("estão em dia com o runner", () => {
    for (const relatorio of relatorios) {
      const nome = relatorio.arquivo.replace(/\.txt$/, ".json");
      const url = new URL(`../../paridade/multipag/${nome}`, import.meta.url);
      const versionado = readFileSync(url, "utf-8");
      assert.strictEqual(
        JSON.stringify(relatorio, null, 2) + "\n",
        versionado,
        `${nome} desatualizado: rode \`bun run paridade\` e commite`
      );
    }
  });

  it("cobrem todo o corpus", () => {
    assert.ok(relatorios.length >= 8, "o corpus tem mais arquivos do que o congelado");
    for (const relatorio of relatorios) {
      assert.ok(relatorio.total_regras > 0, `${relatorio.arquivo}: spec vazio`);
    }
  });
});
