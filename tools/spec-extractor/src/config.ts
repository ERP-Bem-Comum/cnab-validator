export const VALIDADOR_URL =
  "https://wspf.banco.bradesco/wsValidadorUniversal/validadorgeral";

export const ASSETS_DIR = "./assets";
export const SPECS_DIR = "../../specs";

export const LAYOUTS_DO_CICLO = [
  "cobranca-remessa",
  "multipag",
  "folha-pagamento",
] as const;

export const MAPEAMENTO_FUNCOES: Record<string, string> = {
  validarDadosArquivo240: "cobranca-remessa",
  validarDadosArquivo400: "cobranca-remessa",
  validarDadosMultipag: "multipag",
  validarDadosFolha240: "folha-pagamento",
  validarDadosFolha200: "folha-pagamento",
};
