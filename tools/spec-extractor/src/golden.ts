/**
 * Golden test contra o validador oficial — **local e opcional**.
 *
 * O validador do Bradesco é JavaScript que roda no navegador do usuário, não um
 * serviço. Então o oráculo não exige rede: basta executar as próprias funções do
 * banco, a partir do corpus já baixado em `assets/`, e comparar o que elas
 * acusam com o que o runner acusa sobre o mesmo arquivo.
 *
 * Isso respeita o CA2 da issue #7 — nenhuma requisição ao banco — mas **não** é
 * um job de CI: `assets/` não é versionado, e sem ele o script se declara pulado
 * em vez de falhar. Quem quiser rodar faz `bun run dev` antes, uma vez.
 *
 * O que o placar significa:
 *
 * - **só no oficial** — o validador reprova e o runner não. É lacuna de
 *   cobertura: regra não extraída, ou extraída mas não avaliável. Esperado
 *   enquanto o relatório do runner tiver não avaliadas, e é a fila de trabalho.
 * - **só no runner** — o runner reprova o que o validador aprova. É sempre
 *   defeito, e é o único caso que derruba o script: um gate que reprova arquivo
 *   bom é pior que gate nenhum.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext, type Context } from "node:vm";
import { ASSETS_DIR, MAPEAMENTO_FUNCOES, SPECS_DIR, VALIDADOR_URL } from "./config.js";
import { extractInlineScripts, extractScriptUrls } from "./downloader.js";
import { lacunaConhecida } from "./golden-conhecidas.js";
import type { DslRule } from "./rule-mapper.js";
import { aplicarSpec, separarLinhas } from "./runner/index.js";

const CORPUS_DIR = new URL("../tests/fixtures/corpus/", import.meta.url).pathname;

export interface ComparacaoGolden {
  arquivo: string;
  /** Mensagens que só o validador oficial emite: lacuna de cobertura. */
  soOficial: string[];
  /** Mensagens que só o runner emite: falso positivo, sempre defeito. */
  soRunner: string[];
  /** Mensagens que os dois emitem. */
  comuns: string[];
  /**
   * Erro em que o validador oficial abortou, quando aborta. Ele lê `res[j]` sem
   * checar limite, então arquivo truncado o derruba no meio — no navegador, a
   * validação simplesmente não termina. Não há o que comparar nesse caso, e não
   * é defeito do runner: é diferença de robustez, que fica registrada.
   */
  oficialAbortou: string | null;
}

/**
 * Só as mensagens de erro. O relatório do validador começa com data, título e um
 * resumo dos dados do arquivo; nada disso é achado. O que identifica um achado é
 * o mesmo que o extrator usa: a mensagem cita a linha do registro.
 */
function mensagensDeErro(html: string): string[] {
  return html
    .split(/<br\s*\/?>/i)
    .map((parte) => normalizar(parte))
    .filter((texto) => /^Linha \d+[,.]/.test(texto));
}

function normalizar(texto: string): string {
  return texto
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Carrega o corpus do banco num contexto isolado. Os scripts de interface
 * (jQuery, troca de CSS, o verificador que mexe no DOM) estouram sem navegador —
 * e não faz mal: as declarações de função já foram içadas antes do erro, que é o
 * que a validação usa. Os que dependem de DOM para *rodar* recebem os mínimos
 * abaixo.
 */
export function carregarValidadorOficial(): Context | null {
  const htmlPath = join(ASSETS_DIR, "validadorgeral.html");
  if (!existsSync(htmlPath)) return null;

  const html = readFileSync(htmlPath, "utf-8");
  const armazenamento = new Map<string, string>();
  const contexto = createContext({
    console,
    localStorage: {
      getItem: (chave: string) => armazenamento.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazenamento.set(chave, String(valor)),
      removeItem: (chave: string) => armazenamento.delete(chave),
    },
  });

  for (const url of extractScriptUrls(html, VALIDADOR_URL)) {
    const caminho = join(ASSETS_DIR, caminhoRelativo(url));
    if (!existsSync(caminho)) continue;
    executarTolerante(readFileSync(caminho, "utf-8"), contexto);
  }
  for (const script of extractInlineScripts(html)) {
    executarTolerante(script.code, contexto);
  }

  return contexto;
}

function caminhoRelativo(url: string): string {
  return decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
}

function executarTolerante(codigo: string, contexto: Context): void {
  try {
    runInContext(codigo, contexto);
  } catch {
    // Script de interface sem navegador. As funções que ele declara continuam
    // disponíveis — só o efeito colateral de topo é que não roda.
  }
}

/**
 * Roda a função de layout do banco sobre o arquivo. O `hexValue` reproduz o que
 * a página grava ao ler o arquivo: é dele que sai a checagem de CRLF.
 */
export function validarComOficial(
  contexto: Context,
  funcao: string,
  conteudo: string
): string[] {
  const converter = runInContext("typeof converterParaHex", contexto);
  if (converter === "function") {
    const hex = runInContext("converterParaHex", contexto)(conteudo);
    runInContext("localStorage", contexto).setItem("hexValue", hex);
  }
  const validar = runInContext(funcao, contexto) as (linhas: string[]) => string;
  return mensagensDeErro(validar(separarLinhas(conteudo)));
}

function carregarSpec(layout: string): DslRule[] {
  const caminho = join(SPECS_DIR, "layouts", `${layout}.json`);
  return JSON.parse(readFileSync(caminho, "utf-8")).regras as DslRule[];
}

export function compararArquivo(
  contexto: Context,
  funcao: string,
  regras: DslRule[],
  arquivo: string
): ComparacaoGolden {
  const conteudo = readFileSync(join(CORPUS_DIR, arquivo), "utf-8");
  const vazio = { arquivo, soOficial: [], soRunner: [], comuns: [] };

  let oficial: string[];
  try {
    oficial = validarComOficial(contexto, funcao, conteudo);
  } catch (erro) {
    return { ...vazio, oficialAbortou: (erro as Error).message };
  }

  const nosso = aplicarSpec(regras, separarLinhas(conteudo)).achados.map((a) =>
    normalizar(a.mensagem)
  );

  const naoCasadas = new Set(oficial);
  const soRunner: string[] = [];
  const comuns: string[] = [];

  for (const template of new Set(nosso)) {
    const casada = [...naoCasadas].find((m) => casa(template, m));
    if (casada === undefined) {
      soRunner.push(template);
      continue;
    }
    naoCasadas.delete(casada);
    comuns.push(casada);
  }

  return {
    arquivo,
    soOficial: [...naoCasadas].sort(),
    soRunner: soRunner.sort(),
    comuns: comuns.sort(),
    oficialAbortou: null,
  };
}

/**
 * A mensagem do spec é um **template**: o fonte concatena variáveis no texto e o
 * extrator as preserva como `{valor}`. O validador emite a instância. Comparar
 * as duas literalmente marcaria como divergência o mesmo achado escrito de dois
 * jeitos, então o template casa contra a instância como padrão.
 */
function casa(template: string, mensagem: string): boolean {
  if (template === mensagem) return true;
  if (!template.includes("{")) return false;
  const padrao = template
    .split(/\{[^}]*\}/)
    .map((parte) => parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*?");
  return new RegExp(`^${padrao}$`).test(mensagem);
}

export function rodarGolden(layout = "multipag"): ComparacaoGolden[] | null {
  const contexto = carregarValidadorOficial();
  if (!contexto) return null;

  const funcao = Object.entries(MAPEAMENTO_FUNCOES).find(([, l]) => l === layout)?.[0];
  if (!funcao) throw new Error(`Layout sem função de origem em MAPEAMENTO_FUNCOES: ${layout}`);

  const regras = carregarSpec(layout);
  const arquivos = readdirSync(CORPUS_DIR)
    .filter((nome) => nome.endsWith(".txt"))
    .sort();

  return arquivos.map((arquivo) => compararArquivo(contexto, funcao, regras, arquivo));
}

if (import.meta.main) {
  const resultados = rodarGolden();

  if (!resultados) {
    console.log(
      "[golden] Corpus do banco ausente em assets/. Rode `bun run dev` uma vez para baixá-lo; este script não faz rede."
    );
    process.exit(0);
  }

  let falsosPositivos = 0;
  let novas = 0;
  let conhecidas = 0;

  for (const r of resultados) {
    if (r.oficialAbortou) {
      console.log(`\n${r.arquivo}: o validador oficial abortou — ${r.oficialAbortou}`);
      continue;
    }
    console.log(
      `\n${r.arquivo}: ${r.comuns.length} em comum, ${r.soOficial.length} só no oficial, ${r.soRunner.length} só no runner`
    );
    for (const m of r.soOficial) {
      const conhecida = lacunaConhecida(m);
      console.log(`  [${conhecida ? "conhecida" : "lacuna nova"}] ${m}`);
      if (conhecida) conhecidas++;
      else novas++;
    }
    for (const m of r.soRunner) console.log(`  [falso positivo] ${m}`);
    falsosPositivos += r.soRunner.length;
  }

  console.log(
    `\nTotal: ${novas} lacunas novas, ${conhecidas} conhecidas, ${falsosPositivos} falsos positivos.`
  );

  if (falsosPositivos > 0) {
    console.error(
      "Falha: o runner reprova o que o validador oficial aprova. Gate que reprova arquivo bom é pior que gate nenhum."
    );
    process.exit(1);
  }
}
