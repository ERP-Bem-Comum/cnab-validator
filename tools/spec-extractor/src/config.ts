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

/**
 * Família estrutural do arquivo validado por cada função.
 *
 * Não é o mesmo eixo que o layout: `cobranca-remessa` agrega CNAB 240 e CNAB 400,
 * que têm taxonomias de registro incompatíveis — no 240 o tipo de registro está na
 * posição 008 e o código do segmento na coluna 014; no 400/200 o tipo está na
 * coluna 001 e não existe segmento. O extrator precisa da família para classificar
 * o registro a partir da guarda.
 */
export type FamiliaLayout = "cnab240" | "cnab400" | "cnab200";

export const FAMILIA_POR_FUNCAO = {
  validarDadosArquivo240: "cnab240",
  validarDadosArquivo400: "cnab400",
  validarDadosMultipag: "cnab240",
  validarDadosFolha240: "cnab240",
  validarDadosFolha200: "cnab200",
} satisfies Record<keyof typeof MAPEAMENTO_FUNCOES, FamiliaLayout>;
