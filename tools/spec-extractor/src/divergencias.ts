import type { CampoDominio } from "./dominio-mapper.js";

/**
 * Divergências entre o manual e o validador oficial.
 *
 * Este catálogo é **curado**, não extraído: o extrator lê o validador, e o manual
 * não é código. O que o extrator faz é **verificar** cada item — código, rótulo,
 * fatias e linha do fonte saem do spec, e uma divergência declarada sobre código
 * que não existe na extração quebra a geração. Sem isso, o catálogo envelheceria
 * em silêncio quando o banco mudasse o validador.
 *
 * A regra de decisão é a mesma em todos os casos: **prevalece o validador**. Ele é
 * o que efetivamente processa o arquivo.
 */

export type TipoDivergencia =
  /** O código existe nos dois, com significado diferente. */
  | "semantica_divergente"
  /** O validador trata o código; o manual não o documenta. */
  | "ausente_no_manual";

export interface DivergenciaCurada {
  layout: string;
  campo: string;
  codigo: string;
  tipo: TipoDivergencia;
  /** O que o manual diz, em paráfrase — o texto do manual não é versionado. */
  manual: string;
  /** O que um consumidor erra se seguir o manual. */
  consequencia: string;
  confirmado_em: string;
  origem: string;
}

export const DIVERGENCIAS: DivergenciaCurada[] = [
  {
    layout: "retorno-multipag",
    campo: "ocorrencias",
    codigo: "BD",
    tipo: "semantica_divergente",
    manual: "descreve o código como conclusão bem-sucedida do pagamento",
    consequencia:
      "processador que segue o manual dá por pago um pagamento apenas agendado, que ainda pode falhar",
    confirmado_em: "2026-08-19",
    origem: "issue #4",
  },
  {
    layout: "retorno-multipag",
    campo: "ocorrencias",
    codigo: "XX",
    tipo: "ausente_no_manual",
    manual: "não documenta o código",
    consequencia:
      "processador que valide a ocorrência contra o domínio do manual descarta ou rejeita um retorno legítimo",
    confirmado_em: "2026-08-19",
    origem: "issue #4",
  },
];

export interface DivergenciaPublicada extends DivergenciaCurada {
  /** O que o validador faz, lido do próprio spec. */
  validador: {
    rotulo: string;
    slots: number[];
    linha_fonte: number;
    colunas: [number, number];
  };
  prevalece: "validador";
}

export interface CatalogoDivergencias {
  observacao: string;
  regra_de_decisao: string;
  divergencias: DivergenciaPublicada[];
}

export function montarDivergencias(
  camposByLayout: Record<string, CampoDominio[]>,
  curadas: DivergenciaCurada[] = DIVERGENCIAS
): CatalogoDivergencias {
  const divergencias = curadas.map((curada) => {
    const campo = (camposByLayout[curada.layout] ?? []).find(
      (c) => c.campo === curada.campo
    );
    if (!campo) {
      throw new Error(
        `Divergência declarada sobre campo inexistente: ${curada.layout}:${curada.campo}`
      );
    }

    const entrada = campo.entradas.find((e) => e.codigo === curada.codigo);
    if (!entrada) {
      throw new Error(
        `Divergência declarada sobre código que o validador não trata: ${curada.layout}:${curada.campo}:${curada.codigo}`
      );
    }

    return {
      ...curada,
      validador: {
        rotulo: entrada.rotulo,
        slots: entrada.slots,
        linha_fonte: entrada.linha_fonte,
        colunas: campo.colunas,
      },
      prevalece: "validador" as const,
    };
  });

  return {
    observacao:
      "Divergências entre o manual e o validador oficial do Bradesco. O lado do validador é extraído dos assets públicos; o lado do manual é curado e datado.",
    regra_de_decisao:
      "Prevalece o validador: é ele que processa o arquivo. Código fora de ambos os domínios cai em desconhecido, nunca em sucesso.",
    divergencias,
  };
}
