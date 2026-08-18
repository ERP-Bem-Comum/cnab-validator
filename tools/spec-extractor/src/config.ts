import { join } from "node:path";

export const VALIDADOR_URL =
  "https://wspf.banco.bradesco/wsValidadorUniversal/validadorgeral";

const ROOT = import.meta.dirname ?? __dirname;
export const ASSETS_DIR = join(ROOT, "..", "assets");
export const SPECS_DIR = join(ROOT, "..", "..", "specs");

export const LAYOUTS_DO_CICLO = [
  "cobranca-remessa",
  "multipag",
  "folha-pagamento",
] as const;

export const MAPEAMENTO_FUNCOES = {
  validarDadosArquivo240: "cobranca-remessa",
  validarDadosArquivo400: "cobranca-remessa",
  validarDadosMultipag: "multipag",
  validarDadosFolha240: "folha-pagamento",
  validarDadosFolha200: "folha-pagamento",
} satisfies Record<string, (typeof LAYOUTS_DO_CICLO)[number]>;

export interface LayoutMetadata {
  nome: string;
  tipo: "remessa" | "retorno" | "infra";
  tamanhos_linha: number[];
}

export const LAYOUTS: Record<(typeof LAYOUTS_DO_CICLO)[number], LayoutMetadata> = {
  "cobranca-remessa": { nome: "Cobrança — Remessa", tipo: "remessa", tamanhos_linha: [240, 400] },
  multipag: { nome: "Multipag", tipo: "remessa", tamanhos_linha: [240] },
  "folha-pagamento": { nome: "Folha de Pagamento", tipo: "remessa", tamanhos_linha: [200, 240] },
};
