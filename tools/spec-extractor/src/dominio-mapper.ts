import { CAMPOS_NOMEADOS, type FamiliaLayout } from "./config.js";
import { POSICAO_TIPO_REGISTRO, tipoRegistroPorFamilia } from "./ast-walker.js";
import type { TabelaDominio } from "./dominio-extractor.js";

/**
 * Um campo do arquivo cujo conteúdo é decodificado por tabela, e não validado por
 * regra. É o contrato que o consumidor de retorno vai ler.
 */
export interface CampoDominio {
  id: string;
  campo: string;
  funcao_origem: string;
  /** Faixa do campo inteiro, 1-based inclusivo. */
  colunas: [number, number];
  /**
   * O campo carrega mais de um código concatenado. Cada fatia é lida de forma
   * independente pelo fonte — ler só a primeira perde as demais, que costumam
   * ser a causa secundária.
   */
  slots: {
    ordem: number;
    inicio0: number;
    fim0: number;
    colunas: [number, number];
  }[];
  /**
   * Tipos de registro em que o fonte lê este campo. Inclui envelope: recusa de
   * arquivo ou de lote chega por aqui, e quem varrer só o detalhe lê "nenhum
   * erro" num arquivo inteiro recusado.
   */
  registros_lidos: string[];
  /** Código fora do domínio nunca é ignorado nem tratado como sucesso. */
  fora_do_dominio: "desconhecido";
  entradas: EntradaCampo[];
}

export interface EntradaCampo {
  codigo: string;
  rotulo: string;
  /** Fatias que reconhecem este código, na ordem do campo. */
  slots: number[];
  /** Condição adicional do fonte, quando existe. */
  condicao_extra: string | null;
  linha_fonte: number;
}

/**
 * Agrupa as tabelas cruas em campos.
 *
 * As fatias de um mesmo campo aparecem no fonte como tabelas separadas, uma por
 * posição. São reconhecidas por serem contíguas, do mesmo tamanho e por
 * decodificarem praticamente os mesmos códigos — nada disso precisa ser
 * declarado, sai do próprio fonte.
 */
export function mapearCampos(
  tabelas: TabelaDominio[],
  layout: string,
  funcaoOrigem: string,
  familia: FamiliaLayout
): CampoDominio[] {
  const candidatas = tabelas.filter((t) => t.entradas.length > 0);
  const gruposDeSlots = agruparEmSlots(candidatas);

  const campos: CampoDominio[] = gruposDeSlots.map((grupo) => {
    const inicio0 = Math.min(...grupo.map((t) => t.inicio0));
    const fim0 = Math.max(...grupo.map((t) => t.fim0));
    const colunas: [number, number] = [inicio0 + 1, fim0];
    const campo =
      CAMPOS_NOMEADOS[layout]?.[`${colunas[0]}-${colunas[1]}`] ??
      `campo_${colunas[0]}_${colunas[1]}`;

    return {
      id: `${layout}:${funcaoOrigem}:${campo}`,
      campo,
      funcao_origem: funcaoOrigem,
      colunas,
      slots: grupo.map((tabela, ordem) => ({
        ordem: ordem + 1,
        inicio0: tabela.inicio0,
        fim0: tabela.fim0,
        colunas: tabela.colunas,
      })),
      registros_lidos: registrosLidos(grupo, tabelas, familia),
      fora_do_dominio: "desconhecido",
      entradas: unificarEntradas(grupo),
    };
  });

  return unificarCamposIdenticos(campos);
}

/**
 * O fonte repete o mesmo dicionário em blocos diferentes — um por segmento que
 * ele desenha no relatório. Mesma faixa e mesmos códigos é o mesmo campo; o que
 * muda é só onde o relatório o imprime.
 */
function unificarCamposIdenticos(campos: CampoDominio[]): CampoDominio[] {
  const porAssinatura = new Map<string, CampoDominio>();

  for (const campo of campos) {
    const assinatura = `${campo.colunas.join("-")}|${campo.entradas
      .map((e) => e.codigo)
      .join(",")}`;
    const existente = porAssinatura.get(assinatura);
    if (!existente) {
      porAssinatura.set(assinatura, campo);
      continue;
    }
    // Registro lido em qualquer uma das cópias vale para o campo.
    existente.registros_lidos = [
      ...new Set([...existente.registros_lidos, ...campo.registros_lidos]),
    ].sort();
  }

  return [...porAssinatura.values()];
}

/**
 * Fatias do mesmo campo: contíguas, de mesma largura e com praticamente o mesmo
 * domínio. O limiar foi calibrado sobre o corpus: entre as fatias do campo de
 * ocorrências a semelhança é 0,99, e entre dois campos vizinhos de mesma largura
 * que não têm relação (tipo de serviço e forma de lançamento) é 0,48.
 */
function agruparEmSlots(tabelas: TabelaDominio[]): TabelaDominio[][] {
  const ordenadas = [...tabelas].sort((a, b) => a.inicio0 - b.inicio0);
  const grupos: TabelaDominio[][] = [];

  for (const tabela of ordenadas) {
    const grupo = grupos.find((g) => {
      const ultima = g[g.length - 1];
      return (
        ultima.fim0 === tabela.inicio0 &&
        ultima.fim0 - ultima.inicio0 === tabela.fim0 - tabela.inicio0 &&
        semelhanca(ultima, tabela) >= 0.8
      );
    });
    if (grupo) grupo.push(tabela);
    else grupos.push([tabela]);
  }

  return grupos;
}

function semelhanca(a: TabelaDominio, b: TabelaDominio): number {
  const codigosA = new Set(a.entradas.map((e) => e.codigo));
  const codigosB = new Set(b.entradas.map((e) => e.codigo));
  const comuns = [...codigosA].filter((c) => codigosB.has(c)).length;
  return comuns / Math.max(codigosA.size, codigosB.size);
}

/**
 * Tabelas irmãs — mesmo bloco do fonte — que decodificam a posição do tipo de
 * registro dizem em que registros o campo é lido. É o que sustenta a propriedade
 * mais importante do retorno.
 */
function registrosLidos(
  grupo: TabelaDominio[],
  todas: TabelaDominio[],
  familia: FamiliaLayout
): string[] {
  const [inicioTipo, fimTipo] = POSICAO_TIPO_REGISTRO[familia];
  const blocos = new Set(grupo.map((t) => t.bloco));

  const registros = new Set<string>();
  for (const tabela of todas) {
    if (!blocos.has(tabela.bloco)) continue;
    if (tabela.inicio0 !== inicioTipo || tabela.fim0 !== fimTipo) continue;
    for (const entrada of tabela.entradas) {
      registros.add(tipoRegistroPorFamilia(entrada.codigo, familia));
    }
  }
  return [...registros].sort();
}

function unificarEntradas(grupo: TabelaDominio[]): EntradaCampo[] {
  const porCodigo = new Map<string, EntradaCampo>();

  grupo.forEach((tabela, indice) => {
    for (const entrada of tabela.entradas) {
      const atual = porCodigo.get(entrada.codigo);
      if (atual) {
        atual.slots.push(indice + 1);
        continue;
      }
      porCodigo.set(entrada.codigo, {
        codigo: entrada.codigo,
        rotulo: entrada.rotulo,
        slots: [indice + 1],
        condicao_extra: entrada.condicao_extra,
        linha_fonte: entrada.linha_fonte,
      });
    }
  });

  return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}
