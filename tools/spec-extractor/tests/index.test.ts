import { describe, it, expect } from "bun:test";
import { runPipeline } from "../src/index.js";

describe("runPipeline", () => {
  it("executa a orquestração completa com sources em memória", () => {
    const js = `
      function validarDadosArquivo240(res) {
        if (res[0].substring(0, 3) != "237") {
          mensagem = "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.";
        }
      }
    `;
    const sources = new Map<string, string>([["https://example.com/app.js", js]]);

    const result = runPipeline(sources, {
      assetUrls: ["https://example.com/validador", "https://example.com/app.js"],
    });

    expect(result.rulesByLayout["cobranca-remessa"]).toHaveLength(1);
    expect(
      result.rulesByLayout["cobranca-remessa"][0].funcao_origem
    ).toBe("validarDadosArquivo240");
    expect(result.assetUrls).toEqual([
      "https://example.com/validador",
      "https://example.com/app.js",
    ]);
  });

  it("encontra funções inline quando não estão em sources externos", () => {
    const inlineScript = `function validarDadosArquivo240(res) {
      if (res[0].substring(0, 3) != "237") {
        mensagem = "Linha 1, colunas 001 a 003, Header de arquivo, erro.";
      }
    }`;

    const result = runPipeline(new Map(), {
      inlineScripts: [{ code: inlineScript, lineOffset: 10 }],
      assetUrls: ["https://example.com/validador"],
    });

    expect(result.rulesByLayout["cobranca-remessa"]).toHaveLength(1);
    // linha 2 do snippet + offset 10 = 12
    expect(result.rulesByLayout["cobranca-remessa"][0].linha_fonte).toBe(12);
  });
});
