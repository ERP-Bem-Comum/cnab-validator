import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { registroDaGuardaSource } from "../src/ast-walker.js";
import { FAMILIA_POR_FUNCAO, LAYOUTS_DO_CICLO } from "../src/config.js";
import type { DslRule } from "../src/rule-mapper.js";

/**
 * Propriedades dos specs versionados. São invariantes estruturais, não asserções
 * de contagem: o número de regras muda a cada melhoria do extrator, mas nenhuma
 * destas propriedades pode deixar de valer.
 */

function carregar(layout: string): DslRule[] {
  const url = new URL(`../../specs/layouts/${layout}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")).regras as DslRule[];
}

const REGISTROS_ESPERADOS = ["header-arquivo", "trailer-arquivo"];

function familiaDe(regra: DslRule) {
  return FAMILIA_POR_FUNCAO[regra.funcao_origem as keyof typeof FAMILIA_POR_FUNCAO];
}

describe("propriedades dos specs", () => {
  for (const layout of LAYOUTS_DO_CICLO) {
    describe(layout, () => {
      const regras = carregar(layout);

      it("cobre os tipos de registro estruturais do layout", () => {
        const presentes = new Set(regras.map((r) => r.registro));
        for (const esperado of REGISTROS_ESPERADOS) {
          assert.ok(
            presentes.has(esperado),
            `${layout} não tem nenhuma regra de ${esperado}`
          );
        }
        assert.ok(
          [...presentes].some((r) => r.startsWith("segmento-") || r.startsWith("registro-tipo-")),
          `${layout} não tem nenhuma regra de registro de detalhe`
        );
      });

      it("não emite regra sem registro e sem posição ao mesmo tempo", () => {
        // Regra de comprimento de linha é sobre o registro inteiro: não ter faixa
        // de colunas é a modelagem correta dela, não uma extração incompleta.
        const inuteis = regras.filter(
          (r) =>
            r.registro === "nao-classificado" &&
            r.condicao.tipo !== "tamanho_linha" &&
            r.colunas[0] === 0 &&
            r.colunas[1] === 0
        );
        assert.deepStrictEqual(inuteis.map((r) => r.id), []);
      });

      it("nenhum registro contradiz a guarda que o cerca", () => {
        const contradicoes = regras.filter((regra) => {
          if (!regra.condicao_guarda) return false;
          const daGuarda = registroDaGuardaSource(
            regra.condicao_guarda,
            regra.registro_alvo[0] ?? null,
            familiaDe(regra)
          );
          if (!daGuarda || daGuarda === regra.registro) return false;
          // A guarda só sabe dizer "é um detalhe"; a mensagem pode nomear o segmento.
          if (daGuarda === "detalhe" && regra.registro.startsWith("segmento-")) return false;
          return true;
        });
        assert.deepStrictEqual(
          contradicoes.map((r) => `${r.id} registro=${r.registro}`),
          []
        );
      });

      it("registro referenciado é sempre distinto do registro validado", () => {
        const iguais = regras.filter(
          (r) => r.registro_referenciado !== null && r.registro_referenciado === r.registro
        );
        assert.deepStrictEqual(iguais.map((r) => r.id), []);
      });

      it("registro vindo da guarda tem guarda registrada", () => {
        const semGuarda = regras.filter(
          (r) => r.registro_origem === "guarda" && r.condicao_guarda === null
        );
        assert.deepStrictEqual(semGuarda.map((r) => r.id), []);
      });

      it("posições são coerentes entre si", () => {
        const incoerentes = regras.filter((r) => {
          const p = r.posicoes[0];
          if (!p) return r.condicao.tipo !== "tamanho_linha";
          if (p.inicio0 > p.fim0) return true;
          if (p.colunas[0] !== p.inicio0 + 1 || p.colunas[1] !== p.fim0) return true;
          return p.tamanho !== p.fim0 - p.inicio0;
        });
        assert.deepStrictEqual(incoerentes.map((r) => r.id), []);
      });

      it("ids são únicos e determinísticos", () => {
        const ids = regras.map((r) => r.id);
        assert.strictEqual(new Set(ids).size, ids.length);
        for (const regra of regras) {
          assert.strictEqual(
            regra.id,
            `${layout}:${regra.funcao_origem}:${regra.linha_fonte}`
          );
        }
      });
    });
  }
});
