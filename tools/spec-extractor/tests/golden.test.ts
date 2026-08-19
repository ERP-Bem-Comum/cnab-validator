import { describe, it } from "bun:test";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ASSETS_DIR } from "../src/config.js";
import { lacunaConhecida } from "../src/golden-conhecidas.js";
import { rodarGolden } from "../src/golden.js";

/**
 * Golden test contra o validador oficial. Depende do corpus do banco, que não é
 * versionado — sem ele estes testes se declaram pulados em vez de falhar, que é
 * o que mantém o CA2 da issue #7 (o CI não toca a rede do banco) sem abrir mão
 * do oráculo quando ele está à mão.
 */
const temCorpus = existsSync(join(ASSETS_DIR, "validadorgeral.html"));

describe.skipIf(!temCorpus)("golden contra o validador oficial", () => {
  const resultados = temCorpus ? (rodarGolden() ?? []) : [];

  it("o runner não reprova nada que o validador oficial aprove", () => {
    const falsosPositivos = resultados.flatMap((r) =>
      r.soRunner.map((m) => `${r.arquivo}: ${m}`)
    );
    assert.deepStrictEqual(falsosPositivos, []);
  });

  it("toda divergência restante tem causa registrada", () => {
    const semExplicacao = resultados.flatMap((r) =>
      r.soOficial.filter((m) => !lacunaConhecida(m)).map((m) => `${r.arquivo}: ${m}`)
    );
    assert.deepStrictEqual(semExplicacao, []);
  });

  it("o arquivo correto passa também pelo oráculo oficial", () => {
    const correto = resultados.find((r) => r.arquivo === "multipag-correto.txt");
    assert.ok(correto, "o corpus tem de conter o arquivo correto");
    assert.deepStrictEqual(correto.soOficial, []);
    assert.deepStrictEqual(correto.soRunner, []);
  });

  it("os arquivos com defeito injetado são reprovados pelos dois", () => {
    const comDefeito = [
      "multipag-camara-invalida.txt",
      "multipag-forma-lancamento-invalida.txt",
      "multipag-g012-preenchido.txt",
      "multipag-banco-divergente-no-lote.txt",
      "multipag-cpf-dv2-invalido.txt",
    ];
    for (const arquivo of comDefeito) {
      const r = resultados.find((x) => x.arquivo === arquivo);
      assert.ok(r, `${arquivo} não está no corpus`);
      assert.ok(
        r.comuns.length > 0,
        `${arquivo}: o defeito injetado tem de ser acusado pelos dois lados`
      );
    }
  });
});
