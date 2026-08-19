/**
 * Grava o relatório do runner sobre cada arquivo do corpus, para o motor Rust se
 * medir contra ele.
 *
 * O runner é o oráculo mais antigo do repositório e foi conferido contra o
 * validador oficial (`bun run golden`). Congelar a saída dele num arquivo
 * versionado deixa o teste de paridade do `cnab-core` rodar em CI sem depender de
 * Bun — e faz qualquer divergência aparecer no diff, com nome e sobrenome, em vez
 * de virar uma discussão sobre qual dos dois está certo.
 *
 * A forma do JSON segue o lado Rust (`snake_case`) de propósito: é artefato de
 * paridade, não API do runner.
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DslRule } from "./rule-mapper.js";
import { aplicarSpec, separarLinhas, type Relatorio } from "./runner/index.js";

const CORPUS_DIR = new URL("../tests/fixtures/corpus/", import.meta.url).pathname;
const SPECS_DIR = new URL("../../specs/", import.meta.url).pathname;
const DESTINO = new URL("../../paridade/", import.meta.url).pathname;

/** O corpus é todo do Multipag; quando houver outro layout, isto vira lista. */
const LAYOUT = "multipag";

interface RelatorioParidade {
  arquivo: string;
  achados: Relatorio["achados"];
  nao_avaliadas: {
    regra_id: string;
    motivo: string;
    ocorrencias: number;
    detalhe?: string;
  }[];
  regras_avaliadas: number;
  total_regras: number;
  linhas: number;
}

function carregarSpec(layout: string): DslRule[] {
  return JSON.parse(
    readFileSync(join(SPECS_DIR, "layouts", `${layout}.json`), "utf-8")
  ).regras as DslRule[];
}

export function gerarParidade(layout = LAYOUT): RelatorioParidade[] {
  const regras = carregarSpec(layout);
  const arquivos = readdirSync(CORPUS_DIR)
    .filter((nome) => nome.endsWith(".txt"))
    .sort();

  return arquivos.map((arquivo) => {
    const relatorio = aplicarSpec(
      regras,
      separarLinhas(readFileSync(join(CORPUS_DIR, arquivo), "utf-8"))
    );
    return {
      arquivo,
      achados: relatorio.achados,
      // A ordem tem de ser estável entre execuções: o arquivo é versionado.
      nao_avaliadas: [...relatorio.naoAvaliadas]
        .sort((a, b) =>
          a.regra_id === b.regra_id
            ? a.motivo.localeCompare(b.motivo)
            : a.regra_id.localeCompare(b.regra_id)
        )
        .map((n) => ({
          regra_id: n.regra_id,
          motivo: n.motivo,
          ocorrencias: n.ocorrencias,
          ...(n.detalhe ? { detalhe: n.detalhe } : {}),
        })),
      regras_avaliadas: relatorio.regrasAvaliadas,
      total_regras: relatorio.totalRegras,
      linhas: relatorio.linhas,
    };
  });
}

if (import.meta.main) {
  const layout = process.argv[2] ?? LAYOUT;
  const relatorios = gerarParidade(layout);
  const destino = join(DESTINO, layout);
  mkdirSync(destino, { recursive: true });

  for (const relatorio of relatorios) {
    const nome = relatorio.arquivo.replace(/\.txt$/, ".json");
    writeFileSync(join(destino, nome), JSON.stringify(relatorio, null, 2) + "\n", "utf-8");
    console.log(
      `${relatorio.arquivo}: ${relatorio.achados.length} achados, ${relatorio.nao_avaliadas.length} não avaliadas`
    );
  }
  console.log(`Relatórios de paridade escritos em ${destino}`);
}
