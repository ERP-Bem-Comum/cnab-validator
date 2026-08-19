import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { aplicarSpec, separarLinhas } from "../src/runner/index.js";
import type { DslCondition, DslRule } from "../src/rule-mapper.js";

/**
 * As regras do Segmento A e do header de lote que o validador aplica e que o
 * emissor do core-api viola hoje. Cada critério é verificado duas vezes: a regra
 * existe no spec com a forma certa, e o runner a executa — reprovando o arquivo
 * com o defeito e aprovando o correto.
 *
 * As regras são localizadas por **estrutura** (registro, faixa, arquétipo), não
 * por id: o id carrega a linha do fonte e muda quando o banco mexe no arquivo.
 */

const multipag = JSON.parse(
  readFileSync(new URL("../../specs/layouts/multipag.json", import.meta.url), "utf-8")
).regras as DslRule[];

function arquivo(nome: string): string[] {
  return separarLinhas(
    readFileSync(new URL(`./fixtures/corpus/${nome}`, import.meta.url), "utf-8")
  );
}

const correto = arquivo("multipag-correto.txt");

function partesDe(condicao: DslCondition): DslCondition[] {
  return condicao.tipo === "conjuncao" || condicao.tipo === "disjuncao"
    ? condicao.partes
    : [condicao];
}

function achadosDe(nome: string): ReturnType<typeof aplicarSpec>["achados"] {
  return aplicarSpec(multipag, arquivo(nome)).achados;
}

describe("regras do Segmento A e do header de lote (issue #2)", () => {
  it("CA1 — a forma de lançamento é restrita pelo tipo de serviço, com a lista aceita", () => {
    const regra = multipag.find(
      (r) =>
        r.registro === "header-lote" &&
        r.colunas[0] === 12 &&
        r.colunas[1] === 13 &&
        r.condicao.tipo === "dominio" &&
        (r.condicao_guarda ?? "").includes("substring(9, 11) == 20")
    );
    assert.ok(regra, "esperava a restrição de forma de lançamento sob o serviço 20");
    if (regra.condicao.tipo !== "dominio") return;

    assert.strictEqual(regra.condicao.sentido, "permitidos");
    assert.ok(
      regra.condicao.valores.length >= 5,
      "a lista de valores aceitos precisa vir junto, não só a rejeição"
    );
    // O domínio é do fonte, não do manual: a restrição por tipo de serviço só o
    // validador expressa.
    assert.ok(regra.condicao.valores.includes("43"));
    assert.ok(!regra.condicao.valores.includes("44"));
  });

  it("CA1 — o runner reprova forma fora da lista e aprova a de dentro", () => {
    const achados = achadosDe("multipag-forma-lancamento-invalida.txt");
    assert.strictEqual(achados.length, 1);
    assert.strictEqual(achados[0].registro, "header-lote");
    assert.deepStrictEqual(achados[0].colunas, [12, 13]);
    assert.strictEqual(aplicarSpec(multipag, correto).achados.length, 0);
  });

  it("CA2 — a câmara depende do banco do favorecido, como regra condicional", () => {
    const regra = multipag.find((r) => {
      if (r.registro !== "segmento-a" || r.condicao.tipo !== "conjuncao") return false;
      const partes = partesDe(r.condicao);
      const camara = partes.find(
        (p) => p.tipo === "literal_fixo" && p.posicao.inicio0 === 17 && p.valor === "018"
      );
      const banco = partes.find(
        (p) => p.tipo === "literal_fixo" && p.posicao.inicio0 === 20 && p.valor === "237"
      );
      return Boolean(camara && banco);
    });
    // O manual lista o domínio da câmara, mas não a dependência: publicar isso
    // como domínio simples perderia a regra inteira.
    assert.ok(regra, "esperava a dependência câmara × banco como conjunção");
    assert.notStrictEqual(regra.condicao.tipo, "dominio");
  });

  it("CA3 — banco único por lote compara Segmentos A distintos", () => {
    const regra = multipag.find((r) => {
      if (r.registro !== "segmento-a") return false;
      const partes = partesDe(r.condicao);
      return (
        partes.some((p) => "alvo" in p && p.alvo === "res[i]") &&
        partes.some((p) => "alvo" in p && p.alvo === "res[i + 2]")
      );
    });
    assert.ok(regra, "esperava a regra que compara o banco de dois Segmentos A");
    assert.deepStrictEqual(regra.colunas, [21, 23]);
  });

  it("CA3 — o runner reprova lote com bancos diferentes", () => {
    const achados = achadosDe("multipag-banco-divergente-no-lote.txt");
    assert.strictEqual(achados.length, 1);
    assert.deepStrictEqual(achados[0].colunas, [21, 23]);
    assert.strictEqual(achados[0].registro, "segmento-a");
  });

  it("CA4 — o dígito da agência do favorecido tem de ficar em branco", () => {
    const regra = multipag.find(
      (r) =>
        r.registro === "segmento-a" &&
        r.colunas[0] === 43 &&
        r.colunas[1] === 43 &&
        r.condicao.tipo === "literal_fixo"
    );
    assert.ok(regra, "esperava a regra de G012 em branco");
    if (regra.condicao.tipo !== "literal_fixo") return;
    // Não é permissão: é erro se vier preenchido.
    assert.strictEqual(regra.condicao.operador, "!=");
    assert.strictEqual(regra.condicao.valor, " ");
  });

  it("CA4 — o runner reprova G012 preenchido", () => {
    const achados = achadosDe("multipag-g012-preenchido.txt");
    assert.strictEqual(achados.length, 1);
    assert.deepStrictEqual(achados[0].colunas, [43, 43]);
  });

  it("cada arquivo de defeito difere do correto em um campo só", () => {
    for (const nome of [
      "multipag-forma-lancamento-invalida.txt",
      "multipag-g012-preenchido.txt",
    ]) {
      const defeito = arquivo(nome);
      const diferentes = correto
        .map((linha, i) => (linha === defeito[i] ? null : i))
        .filter((i): i is number => i !== null);
      assert.strictEqual(diferentes.length, 1, `${nome} deveria mudar uma linha só`);
    }
  });
});
