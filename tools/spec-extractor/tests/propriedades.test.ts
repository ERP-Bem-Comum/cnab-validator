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
          if (r.posicoes.length === 0) return r.condicao.tipo !== "tamanho_linha";
          // Uma regra pode publicar mais de uma faixa (disjunção sobre campos
          // diferentes); todas precisam ser coerentes, não só a primeira.
          return r.posicoes.some(
            (p) =>
              p.inicio0 > p.fim0 ||
              p.colunas[0] !== p.inicio0 + 1 ||
              p.colunas[1] !== p.fim0 ||
              p.tamanho !== p.fim0 - p.inicio0
          );
        });
        assert.deepStrictEqual(incoerentes.map((r) => r.id), []);
      });

      it("colunas da regra envolvem todas as faixas que ela lê", () => {
        const foraDoEnvelope = regras.filter((r) => {
          if (r.posicoes.length === 0) return false;
          const inicio = Math.min(...r.posicoes.map((p) => p.colunas[0]));
          const fim = Math.max(...r.posicoes.map((p) => p.colunas[1]));
          return r.colunas[0] > inicio || r.colunas[1] < fim;
        });
        assert.deepStrictEqual(foraDoEnvelope.map((r) => r.id), []);
      });

      it("domínio publica sentido e ao menos um valor", () => {
        const invalidos = regras.filter(
          (r) =>
            r.condicao.tipo === "dominio" &&
            (r.condicao.valores.length === 0 ||
              (r.condicao.sentido !== "permitidos" && r.condicao.sentido !== "proibidos"))
        );
        assert.deepStrictEqual(invalidos.map((r) => r.id), []);
      });

      it("disjunção nunca esconde uma parte não modelada", () => {
        const comCustom = regras.filter(
          (r) =>
            r.condicao.tipo === "disjuncao" &&
            r.condicao.partes.some((parte) => parte.tipo === "custom")
        );
        assert.deepStrictEqual(comCustom.map((r) => r.id), []);
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
