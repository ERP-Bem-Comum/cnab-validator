import { describe, it, expect } from "bun:test";
import { runPipeline } from "../src/index.js";

describe("runPipeline", () => {
  it("executa a orquestração completa com HTML e sources em memória", () => {
    const html = '<html><script src="/app.js"></script></html>';
    const js = `
      function validarDadosArquivo240(res) {
        if (res[0].substring(0, 3) != "237") {
          mensagem = "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.";
        }
      }
    `;
    const sources = new Map<string, string>([["https://example.com/app.js", js]]);

    const result = runPipeline(html, sources, {
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
    const html = "<html></html>";
    const inlineScript = `function validarDadosArquivo240(res) {
      if (res[0].substring(0, 3) != "237") {
        mensagem = "Linha 1, colunas 001 a 003, Header de arquivo, erro.";
      }
    }`;

    const result = runPipeline(html, new Map(), {
      inlineScripts: [inlineScript],
      assetUrls: ["https://example.com/validador"],
    });

    expect(result.rulesByLayout["cobranca-remessa"]).toHaveLength(1);
    expect(result.rulesByLayout["cobranca-remessa"][0].linha_fonte).toBe(2);
  });
});
