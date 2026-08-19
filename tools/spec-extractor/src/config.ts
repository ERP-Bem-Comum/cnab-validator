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
  "retorno-multipag",
] as const;

export const MAPEAMENTO_FUNCOES = {
  validarDadosArquivo240: "cobranca-remessa",
  validarDadosArquivo400: "cobranca-remessa",
  validarDadosMultipag: "multipag",
  validarDadosFolha240: "folha-pagamento",
  validarDadosFolha200: "folha-pagamento",
  retorno_multipag_folha240: "retorno-multipag",
} satisfies Record<string, (typeof LAYOUTS_DO_CICLO)[number]>;

/**
 * Como o fonte expressa o que precisa ser extraído.
 *
 * `regras` é a forma "condição → mensagem de erro" que o `ast-walker` reconhece.
 * `tabelas` é a forma "campo igual a código → rótulo" do arquivo de retorno, que
 * é dicionário e não regra — daí um fonte de 32 mil linhas com poucas dezenas de
 * mensagens de erro.
 */
export const MODO_POR_FUNCAO = {
  validarDadosArquivo240: "regras",
  validarDadosArquivo400: "regras",
  validarDadosMultipag: "regras",
  validarDadosFolha240: "regras",
  validarDadosFolha200: "regras",
  retorno_multipag_folha240: "tabelas",
} satisfies Record<keyof typeof MAPEAMENTO_FUNCOES, "regras" | "tabelas">;

export interface LayoutMetadata {
  nome: string;
  tipo: "remessa" | "retorno" | "infra";
  tamanhos_linha: number[];
}

export const LAYOUTS: Record<(typeof LAYOUTS_DO_CICLO)[number], LayoutMetadata> = {
  "cobranca-remessa": { nome: "Cobrança — Remessa", tipo: "remessa", tamanhos_linha: [240, 400] },
  multipag: { nome: "Multipag", tipo: "remessa", tamanhos_linha: [240] },
  "folha-pagamento": { nome: "Folha de Pagamento", tipo: "remessa", tamanhos_linha: [200, 240] },
  "retorno-multipag": { nome: "Multipag/Folha — Retorno", tipo: "retorno", tamanhos_linha: [240] },
};

/**
 * Nome do campo por faixa de colunas (1-based inclusivo), quando o fonte não o
 * nomeia. O extrator descobre a faixa e os códigos sozinho; o rótulo do campo é
 * conhecimento do time, e fica aqui em vez de ser adivinhado do texto.
 */
export const CAMPOS_NOMEADOS: Record<string, Record<string, string>> = {
  "retorno-multipag": { "231-240": "ocorrencias" },
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
  retorno_multipag_folha240: "cnab240",
} satisfies Record<keyof typeof MAPEAMENTO_FUNCOES, FamiliaLayout>;
