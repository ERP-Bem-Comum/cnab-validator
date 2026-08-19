import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extrairTabelasDeDominio } from "../src/dominio-extractor.js";
import { mapearCampos } from "../src/dominio-mapper.js";
import { montarDivergencias, DIVERGENCIAS } from "../src/divergencias.js";
import type { CampoDominio } from "../src/dominio-mapper.js";

function carregarRetorno(): { regras: unknown[]; campos: CampoDominio[] } {
  const url = new URL("../../specs/layouts/retorno-multipag.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8"));
}

function carregarDivergencias() {
  const url = new URL("../../specs/divergencias.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8"));
}

const FIXTURE = `
function retorno_amostra(res) {
    var resposta = "";
    var i = 0;
    while (i < 10) {
        if (isNaN(res[i].substring(230, 240))) ocorrencias();
        i++;
        function ocorrencias() {
            if (res[i].substring(7, 8) == "0")
                resposta = resposta + "<pre><b>Header de Arquivo</b> ";
            if (res[i].substring(7, 8) == 9)
                resposta = resposta + "<pre><b>Trailer de Arquivo</b> ";
            if (res[i].substring(230, 232) == "XX")
                resposta = resposta + "      XX - Codigo fora do manual.";
            if (res[i].substring(230, 232) == 00 && res[i].substring(13, 14) != "B")
                resposta = resposta + "      00 - Efetivado";
            if (res[i].substring(230, 232) == 01)
                resposta = resposta + "      01 - Recusado";
            if (res[i].substring(230, 232) == 02)
                resposta = resposta + "      02 - Cancelado";
            if (res[i].substring(230, 232) == 03)
                resposta = resposta + "      03 - Devolvido";
            if (res[i].substring(232, 234) == "XX")
                resposta = resposta + " / XX - Codigo fora do manual.";
            if (res[i].substring(232, 234) == 01)
                resposta = resposta + " / 01 - Recusado";
            if (res[i].substring(232, 234) == 02)
                resposta = resposta + " / 02 - Cancelado";
            if (res[i].substring(232, 234) == 03)
                resposta = resposta + " / 03 - Devolvido";
            if (res[i].substring(232, 234) == 04)
                resposta = resposta + " / 04 - Estornado";
            resposta = resposta + "==========================================";
        }
    }
    return resposta;
}
`;

describe("extração de tabela de domínio", () => {
  it("entra em função aninhada — é onde o catálogo do retorno vive", () => {
    const tabelas = extrairTabelasDeDominio(FIXTURE, "retorno_amostra");
    const faixas = tabelas.map((t) => t.colunas.join("-")).sort();
    assert.deepStrictEqual(faixas, ["231-232", "233-234", "8-8"]);
  });

  it("preserva a condição extra do fonte em vez de descartá-la", () => {
    const tabelas = extrairTabelasDeDominio(FIXTURE, "retorno_amostra");
    const slot1 = tabelas.find((t) => t.inicio0 === 230);
    const zero = slot1?.entradas.find((e) => e.codigo === "00");
    assert.strictEqual(zero?.condicao_extra, 'res[i].substring(13, 14) != "B"');
  });

  it("descarta moldura de relatório, que não é rótulo de código", () => {
    const tabelas = extrairTabelasDeDominio(FIXTURE, "retorno_amostra");
    for (const tabela of tabelas) {
      for (const entrada of tabela.entradas) {
        assert.match(entrada.rotulo, /\p{L}/u);
      }
    }
  });

  it("agrupa as fatias contíguas do mesmo campo e unifica os códigos", () => {
    const tabelas = extrairTabelasDeDominio(FIXTURE, "retorno_amostra");
    const campos = mapearCampos(tabelas, "retorno-multipag", "retorno_amostra", "cnab240");
    const ocorrencias = campos.find((c) => c.colunas[0] === 231);

    assert.ok(ocorrencias);
    assert.strictEqual(ocorrencias.slots.length, 2);
    assert.deepStrictEqual(
      ocorrencias.entradas.find((e) => e.codigo === "XX")?.slots,
      [1, 2]
    );
    // `00` só é decodificado na primeira fatia; publicar como se valesse em todas
    // seria afirmar o que o fonte não faz.
    assert.deepStrictEqual(
      ocorrencias.entradas.find((e) => e.codigo === "00")?.slots,
      [1]
    );
  });

  it("registra os tipos de registro em que o campo é lido", () => {
    const tabelas = extrairTabelasDeDominio(FIXTURE, "retorno_amostra");
    const campos = mapearCampos(tabelas, "retorno-multipag", "retorno_amostra", "cnab240");
    const ocorrencias = campos.find((c) => c.colunas[0] === 231);
    assert.deepStrictEqual(ocorrencias?.registros_lidos, [
      "header-arquivo",
      "trailer-arquivo",
    ]);
  });
});

describe("spec de retorno versionado", () => {
  const spec = carregarRetorno();
  const ocorrencias = spec.campos.find((c) => c.campo === "ocorrencias");

  it("CA1 — a ocorrência é lida no envelope, não só no detalhe", () => {
    // É a propriedade mais importante do retorno: recusa de arquivo ou de lote
    // chega por aqui, e quem varrer só o detalhe lê "nenhum erro" num arquivo
    // inteiro recusado.
    assert.ok(ocorrencias);
    for (const registro of [
      "header-arquivo",
      "header-lote",
      "trailer-lote",
      "trailer-arquivo",
    ]) {
      assert.ok(
        ocorrencias.registros_lidos.includes(registro),
        `${registro} deveria estar entre os registros que carregam ocorrência`
      );
    }
  });

  it("CA2 — o campo carrega cinco códigos, e todas as fatias são publicadas", () => {
    assert.ok(ocorrencias);
    assert.strictEqual(ocorrencias.slots.length, 5);
    assert.deepStrictEqual(ocorrencias.colunas, [231, 240]);
    for (const slot of ocorrencias.slots) {
      assert.strictEqual(slot.fim0 - slot.inicio0, 2, "cada fatia tem dois dígitos");
    }
    // As fatias são contíguas e cobrem o campo inteiro.
    const inicio = Math.min(...ocorrencias.slots.map((s) => s.inicio0));
    const fim = Math.max(...ocorrencias.slots.map((s) => s.fim0));
    assert.strictEqual(fim - inicio, 10);
  });

  it("CA4 — o spec obriga balde para código fora do domínio", () => {
    assert.ok(ocorrencias);
    assert.strictEqual(ocorrencias.fora_do_dominio, "desconhecido");
  });

  it("o id identifica um campo só", () => {
    // A faixa não basta: o fonte decodifica as mesmas colunas em blocos
    // diferentes com dicionários diferentes — 016-017 é situação do pagamento
    // num bloco e ocorrência de cobrança em outro. Com id repetido, quem indexar
    // por id perde um catálogo inteiro sem perceber.
    const ids = spec.campos.map((c) => c.id);
    assert.strictEqual(new Set(ids).size, ids.length, "id de campo repetido");
  });

  it("códigos não se repetem dentro de um campo", () => {
    for (const campo of spec.campos) {
      const codigos = campo.entradas.map((e) => e.codigo);
      assert.strictEqual(
        new Set(codigos).size,
        codigos.length,
        `${campo.campo} tem código repetido`
      );
    }
  });

  it("toda entrada aponta uma fatia que existe", () => {
    for (const campo of spec.campos) {
      const ordens = new Set(campo.slots.map((s) => s.ordem));
      for (const entrada of campo.entradas) {
        assert.ok(entrada.slots.length > 0, `${entrada.codigo} sem fatia`);
        for (const slot of entrada.slots) {
          assert.ok(ordens.has(slot), `${entrada.codigo} aponta fatia inexistente`);
        }
      }
    }
  });
});

describe("catálogo de divergências", () => {
  const catalogo = carregarDivergencias();

  it("CA5 — o código de semântica divergente prevalece pelo validador", () => {
    const bd = catalogo.divergencias.find((d: { codigo: string }) => d.codigo === "BD");
    assert.ok(bd, "BD deveria estar catalogado");
    assert.strictEqual(bd.tipo, "semantica_divergente");
    assert.strictEqual(bd.prevalece, "validador");
    assert.ok(bd.validador.rotulo.length > 0);
    assert.ok(bd.validador.linha_fonte > 0);
  });

  it("CA3 — código ausente do manual é reconhecido com a semântica do validador", () => {
    const xx = catalogo.divergencias.find((d: { codigo: string }) => d.codigo === "XX");
    assert.ok(xx, "XX deveria estar catalogado");
    assert.strictEqual(xx.tipo, "ausente_no_manual");
    assert.deepStrictEqual(xx.validador.slots, [1, 2, 3, 4, 5]);
  });

  it("divergência sobre código que o validador não trata quebra a geração", () => {
    // A curadoria envelhece se o banco mexer no validador; falhar alto é o que
    // impede o catálogo de mentir em silêncio.
    const spec = carregarRetorno();
    assert.throws(
      () =>
        montarDivergencias({ "retorno-multipag": spec.campos }, [
          { ...DIVERGENCIAS[0], codigo: "ZZZ-INEXISTENTE" },
        ]),
      /não trata/
    );
  });
});
