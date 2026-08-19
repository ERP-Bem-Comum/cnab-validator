import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LAYOUTS } from "./config.js";
import { montarDivergencias } from "./divergencias.js";
import type { CampoDominio } from "./dominio-mapper.js";
import type { DslRule } from "./rule-mapper.js";

const VALID_LAYOUT_KEY = /^[a-z0-9-]+$/;

function assertValidLayout(layout: string): void {
  if (!VALID_LAYOUT_KEY.test(layout)) {
    throw new Error(`Invalid layout key: ${layout}`);
  }
}

function tipoLayout(layout: string): "remessa" | "retorno" | "infra" {
  const meta = LAYOUTS[layout as keyof typeof LAYOUTS];
  if (!meta) throw new Error(`Unknown layout: ${layout}`);
  return meta.tipo;
}

export interface LayoutEntry {
  layout: string;
  nome: string;
  tipo: "remessa" | "retorno" | "infra";
  tamanhos_linha: number[];
  arquivo: string;
  total_regras: number;
  /** Campos decodificados por tabela — só o retorno tem. */
  total_campos: number;
  total_codigos: number;
  sub_layouts: {
    funcao: string;
    regras: number;
  }[];
}

export interface IndexSpec {
  fonte: string;
  observacao: string;
  total_regras: number;
  layouts: LayoutEntry[];
}

export interface LayoutSpec {
  layout: string;
  nome: string;
  tipo: "remessa" | "retorno" | "infra";
  tamanhos_linha: number[];
  regras: DslRule[];
  /**
   * Campos cujo conteúdo é decodificado por tabela em vez de validado por regra.
   * O arquivo de retorno é feito disto; os de remessa não têm nenhum.
   */
  campos: CampoDominio[];
}

export function writeSpecs(
  specsDir: string,
  rulesByLayout: Record<string, DslRule[]>,
  camposByLayout: Record<string, CampoDominio[]> = {}
): void {
  mkdirSync(join(specsDir, "layouts"), { recursive: true });

  const index: IndexSpec = {
    fonte: "https://wspf.banco.bradesco/wsValidadorUniversal/validadorgeral",
    observacao:
      "Regras extraídas por AST dos arquivos JS públicos do validador Bradesco.",
    total_regras: Object.values(rulesByLayout).reduce(
      (sum, rules) => sum + rules.length,
      0
    ),
    layouts: Object.entries(rulesByLayout).map(([layout, rules]) => {
      assertValidLayout(layout);

      const campos = camposByLayout[layout] ?? [];
      const tipo = tipoLayout(layout);
      const entry: LayoutEntry = {
        layout,
        nome: LAYOUTS[layout as keyof typeof LAYOUTS].nome,
        tipo,
        tamanhos_linha: LAYOUTS[layout as keyof typeof LAYOUTS].tamanhos_linha,
        arquivo: join("layouts", `${layout}.json`),
        total_regras: rules.length,
        total_campos: campos.length,
        total_codigos: campos.reduce((soma, campo) => soma + campo.entradas.length, 0),
        sub_layouts: subLayouts(layout, rules),
      };

      const layoutSpec: LayoutSpec = {
        layout,
        nome: entry.nome,
        tipo: entry.tipo,
        tamanhos_linha: entry.tamanhos_linha,
        regras: rules,
        campos,
      };

      writeFileSync(
        join(specsDir, "layouts", `${layout}.json`),
        JSON.stringify(layoutSpec, null, 2) + "\n",
        "utf-8"
      );

      return entry;
    }),
  };

  writeFileSync(
    join(specsDir, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
    "utf-8"
  );

  // Só faz sentido quando há campo extraído: sem retorno no ciclo, não há o que
  // comparar com o manual.
  if (Object.keys(camposByLayout).length > 0) {
    writeFileSync(
      join(specsDir, "divergencias.json"),
      JSON.stringify(montarDivergencias(camposByLayout), null, 2) + "\n",
      "utf-8"
    );
  }
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
