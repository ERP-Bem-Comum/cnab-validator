import type { DslRule } from "../rule-mapper.js";
import { avaliarCondicao, resolverIndice } from "./condicao.js";
import {
  avaliarExpressao,
  ExpressaoNaoSuportada,
  type ContextoArquivo,
} from "./expressao.js";

/**
 * Runner de conformidade: aplica um spec a um arquivo e devolve os achados.
 *
 * É **oráculo de teste, não validador**. Não detecta layout, não trata encoding,
 * não tem CLI nem API. O validador é a Fase 1, em Rust; quando ele existir, os
 * dois rodam sobre o mesmo corpus e o diff entre eles é o teste de paridade.
 */

export interface Achado {
  regra_id: string;
  /** Número da linha, 1-based, como o validador oficial reporta. */
  linha: number;
  registro: string;
  colunas: [number, number];
  mensagem: string;
}

export type MotivoNaoAvaliada =
  /** A condição é `custom`: o extrator não modelou o teste. */
  | "condicao_custom"
  /** A condição tem arquétipo, mas depende de algo que o spec não carrega. */
  | "condicao_incompleta"
  /** A guarda usa forma que o avaliador de expressão não reconhece. */
  | "guarda_nao_avaliavel";

export interface NaoAvaliada {
  regra_id: string;
  motivo: MotivoNaoAvaliada;
  /** Em quantas linhas a regra deixou de ser avaliada. */
  ocorrencias: number;
  detalhe?: string;
}

export interface Relatorio {
  achados: Achado[];
  naoAvaliadas: NaoAvaliada[];
  /** Regras que foram avaliadas ao menos uma vez sem erro. */
  regrasAvaliadas: number;
  totalRegras: number;
  linhas: number;
}

/**
 * Divide o arquivo como o validador faz: por quebra de linha, sem tocar no
 * conteúdo. Uma linha final vazia (arquivo terminado em `\n`) não é registro.
 */
export function separarLinhas(conteudo: string): string[] {
  const linhas = conteudo.split(/\r?\n/);
  while (linhas.length > 0 && linhas[linhas.length - 1] === "") linhas.pop();
  return linhas;
}

export function aplicarSpec(regras: DslRule[], linhas: string[]): Relatorio {
  const achados: Achado[] = [];
  const naoAvaliadas = new Map<string, NaoAvaliada>();
  const avaliadas = new Set<string>();

  const registrar = (
    regra: DslRule,
    motivo: MotivoNaoAvaliada,
    detalhe?: string
  ): void => {
    const chave = `${regra.id}|${motivo}`;
    const atual = naoAvaliadas.get(chave);
    if (atual) {
      atual.ocorrencias += 1;
      return;
    }
    naoAvaliadas.set(chave, { regra_id: regra.id, motivo, ocorrencias: 1, detalhe });
  };

  for (const regra of regras) {
    for (const i of linhasDaRegra(regra, linhas)) {
      const ctx: ContextoArquivo = { linhas, i };

      if (regra.condicao_guarda) {
        let guarda: boolean;
        try {
          guarda = avaliarExpressao(regra.condicao_guarda, ctx);
        } catch (erro) {
          if (!(erro instanceof ExpressaoNaoSuportada)) throw erro;
          registrar(regra, "guarda_nao_avaliavel", erro.message);
          continue;
        }
        if (!guarda) continue;
      }

      const resultado = avaliarCondicao(regra.condicao, ctx);
      if (resultado === null) {
        registrar(
          regra,
          regra.condicao.tipo === "custom" ? "condicao_custom" : "condicao_incompleta"
        );
        continue;
      }

      avaliadas.add(regra.id);
      if (resultado) {
        achados.push({
          regra_id: regra.id,
          linha: linhaRelatada(regra, i),
          registro: regra.registro,
          colunas: regra.colunas,
          mensagem: preencherMensagem(regra.mensagem, linhaRelatada(regra, i)),
        });
      }
    }
  }

  return {
    achados,
    naoAvaliadas: [...naoAvaliadas.values()],
    regrasAvaliadas: avaliadas.size,
    totalRegras: regras.length,
    linhas: linhas.length,
  };
}

/**
 * Sobre quais linhas a regra roda. Regra cujo alvo é uma linha fixa (`res[0]`) é
 * avaliada uma vez só — o fonte a escreve fora do laço, e repeti-la por linha
 * produziria o mesmo achado N vezes.
 */
function linhasDaRegra(regra: DslRule, linhas: string[]): number[] {
  const alvo = regra.registro_alvo[0] ?? "res[0]";
  const fixo = alvo.match(/^res\[(\d+)\]$/);
  if (fixo) return [Number(fixo[1])];
  return linhas.map((_, i) => i);
}

/** A linha que a mensagem reporta é a do alvo, que nem sempre é a linha corrente. */
function linhaRelatada(regra: DslRule, i: number): number {
  const alvo = regra.registro_alvo[0] ?? "res[0]";
  const indice = resolverIndice(alvo, { linhas: [], i });
  return (indice ?? i) + 1;
}

function preencherMensagem(mensagem: string, linha: number): string {
  return mensagem.replace(/\{linha\}/g, String(linha));
}
