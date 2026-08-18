import { mkdirSync, writeFileSync } from "node:fs";
import type { DslRule } from "./rule-mapper.js";

export interface LayoutEntry {
  layout: string;
  nome: string;
  tipo: "remessa" | "retorno" | "infra";
  tamanhos_linha: number[];
  arquivo: string;
  total_regras: number;
  sub_layouts: {
    funcao: string;
    regras: number;
  }[];
}

export interface IndexSpec {
  fonte: string;
  extraido_em: string;
  observacao: string;
  total_regras: number;
  layouts: LayoutEntry[];
}

export interface LayoutSpec {
  layout: string;
  nome: string;
  tipo: string;
  tamanhos_linha: number[];
  regras: DslRule[];
}

export function writeSpecs(
  specsDir: string,
  rulesByLayout: Record<string, DslRule[]>
): void {
  mkdirSync(`${specsDir}/layouts`, { recursive: true });

  const index: IndexSpec = {
    fonte: "https://wspf.banco.bradesco/wsValidadorUniversal/validadorgeral",
    extraido_em: new Date().toISOString().split("T")[0],
    observacao:
      "Regras extraídas por AST dos arquivos JS públicos do validador Bradesco.",
    total_regras: Object.values(rulesByLayout).reduce(
      (sum, rules) => sum + rules.length,
      0
    ),
    layouts: Object.entries(rulesByLayout).map(([layout, rules]) => {
      const entry: LayoutEntry = {
        layout,
        nome: nomeLayout(layout),
        tipo: "remessa",
        tamanhos_linha: tamanhosLayout(layout),
        arquivo: `layouts/${layout}.json`,
        total_regras: rules.length,
        sub_layouts: subLayouts(layout, rules),
      };

      const layoutSpec: LayoutSpec = {
        layout,
        nome: entry.nome,
        tipo: entry.tipo,
        tamanhos_linha: entry.tamanhos_linha,
        regras: rules,
      };

      writeFileSync(
        `${specsDir}/layouts/${layout}.json`,
        JSON.stringify(layoutSpec, null, 2),
        "utf-8"
      );

      return entry;
    }),
  };

  writeFileSync(`${specsDir}/index.json`, JSON.stringify(index, null, 2), "utf-8");
}

function nomeLayout(layout: string): string {
  const nomes: Record<string, string> = {
    "cobranca-remessa": "Cobrança — Remessa",
    multipag: "Multipag",
    "folha-pagamento": "Folha de Pagamento",
  };
  return nomes[layout] ?? layout;
}

function tamanhosLayout(layout: string): number[] {
  const tamanhos: Record<string, number[]> = {
    "cobranca-remessa": [240, 400],
    multipag: [240],
    "folha-pagamento": [200, 240],
  };
  return tamanhos[layout] ?? [];
}

function subLayouts(layout: string, rules: DslRule[]): { funcao: string; regras: number }[] {
  const grupos = new Map<string, number>();
  for (const r of rules) {
    grupos.set(r.funcao_origem, (grupos.get(r.funcao_origem) ?? 0) + 1);
  }
  return Array.from(grupos.entries()).map(([funcao, count]) => ({
    funcao,
    regras: count,
  }));
}
