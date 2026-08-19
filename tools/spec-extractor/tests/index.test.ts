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

  it("cobre pelo menos um tipo de registro por layout (propriedade, não contagem)", () => {
    const js = `
      function validarDadosMultipag(res) {
        var str = "";
        if (res[0].substring(3, 7) != "0000") {
          str += "Linha 1, Header de arquivo, colunas 004 a 007, lote inválido.<br>";
        }
        if (res[1].substring(7, 8) == "1") {
          if (res[1].substring(13, 14) != "A") {
            str += "Linha 2, Header de lote, coluna 014, segmento inválido.<br>";
          }
        }
        for (var i = 2; i < res.length - 1; i++) {
          if (res[i].substring(7, 8) == "3") {
            if (res[i].substring(13, 14) == "A") {
              str += "Segmento A, coluna 014, movimento inválido.<br>";
            }
            if (res[i].substring(13, 14) == "B") {
              str += "Segmento B, coluna 014, inscrição inválida.<br>";
            }
          }
          if (res[i].substring(7, 8) == "5") {
            str += "Trailer de lote, coluna 018, total inválido.<br>";
          }
        }
        if (res[res.length - 1].substring(7, 8) == "9") {
          str += "Trailer de arquivo, coluna 018, total inválido.<br>";
        }
        return str;
      }
    `;
    const sources = new Map<string, string>([["https://example.com/multipag.js", js]]);
    const result = runPipeline(sources, {
      assetUrls: ["https://example.com/validador", "https://example.com/multipag.js"],
    });

    const rules = result.rulesByLayout["multipag"];
    expect(rules).toBeDefined();
    const registros = new Set(rules.map((r) => r.registro));
    expect(registros.has("header-arquivo")).toBe(true);
    expect(registros.has("header-lote")).toBe(true);
    expect(registros.has("segmento-a")).toBe(true);
    expect(registros.has("segmento-b")).toBe(true);
    expect(registros.has("trailer-lote")).toBe(true);
    expect(registros.has("trailer-arquivo")).toBe(true);
  });
});
