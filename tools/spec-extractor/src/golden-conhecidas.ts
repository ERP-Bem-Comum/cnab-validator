/**
 * Divergências que o golden test **já explicou**, para que o placar mostre o que
 * é novo.
 *
 * Entrar aqui exige saber por que o runner não reproduz o achado, e a explicação
 * é parte do registro. Lacuna sem causa conhecida fica de fora de propósito: é
 * ela que o script existe para mostrar.
 */

export interface LacunaConhecida {
  /** Trecho literal da mensagem do validador oficial. */
  trecho: string;
  motivo: string;
}

export const LACUNAS_CONHECIDAS: LacunaConhecida[] = [
  {
    trecho: "Número de inscrição está zerado",
    motivo:
      "Defeito do validador oficial. A regra é `obterValorCNPJAlfanumerico(res[0].substring(18, 32)) == 0`, " +
      "e essa função é `caractere.toUpperCase().charCodeAt(0) - 48` — ela lê **um** caractere. " +
      "Chamada com as 14 posições da inscrição, decide pela primeira: qualquer inscrição que comece " +
      "em '0' é declarada zerada. Como a regra vizinha exige as colunas 019 a 021 zeradas quando a " +
      "empresa é identificada por CPF, todo header com CPF cai nas duas ao mesmo tempo. " +
      "No header de lote o mesmo teste está escrito sem a função (`substring(18, 32) == 0`), o que " +
      "confirma o defeito em vez de sugerir intenção. O spec preserva a regra como `custom` com a " +
      "condição original intacta, e o runner a reporta como não avaliada.",
  },
];

export function lacunaConhecida(mensagem: string): LacunaConhecida | undefined {
  return LACUNAS_CONHECIDAS.find((l) => mensagem.includes(l.trecho));
}
