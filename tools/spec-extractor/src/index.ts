import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  ASSETS_DIR,
  FAMILIA_POR_FUNCAO,
  LAYOUTS_DO_CICLO,
  MAPEAMENTO_FUNCOES,
  MODO_POR_FUNCAO,
  SPECS_DIR,
  VALIDADOR_URL,
} from "./config.js";
import {
  downloadText,
  extractInlineScripts,
  extractScriptUrls,
  saveAsset,
  type InlineScript,
} from "./downloader.js";
import { extractNamedFunctions } from "./inline-parser.js";
import { extractRulesFromFunction } from "./ast-walker.js";
import { extrairTabelasDeDominio } from "./dominio-extractor.js";
import { mapearCampos, type CampoDominio } from "./dominio-mapper.js";
import { mapToDsl } from "./rule-mapper.js";
import { writeSpecs } from "./spec-generator.js";

const BASELINE_PATH = new URL("../baseline.json", import.meta.url);

export interface MainResult {
  baselineSha256: string;
  rulesByLayout: Record<string, ReturnType<typeof mapToDsl>[]>;
  camposByLayout: Record<string, CampoDominio[]>;
}

export interface PipelineResult {
  assetUrls: string[];
  sources: Map<string, string>;
  rulesByLayout: Record<string, ReturnType<typeof mapToDsl>[]>;
  /** Campos decodificados por tabela — a forma do arquivo de retorno. */
  camposByLayout: Record<string, CampoDominio[]>;
}

export interface Logger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

const noopLogger: Logger = {
  log: () => {},
  warn: () => {},
};

const consoleLogger: Logger = {
  log: console.log,
  warn: console.warn,
};

interface FunctionSource {
  source: string;
  fonte: string;
  lineOffset: number;
}

function buildFunctionIndex(
  sources: Map<string, string>,
  inlineScripts: InlineScript[]
): Map<string, FunctionSource[]> {
  const index = new Map<string, FunctionSource[]>();

  for (const [url, content] of sources) {
    for (const name of extractNamedFunctions(content).keys()) {
      const entry = index.get(name) ?? [];
      entry.push({ source: content, fonte: url, lineOffset: 0 });
      index.set(name, entry);
    }
  }

  for (const script of inlineScripts) {
    for (const name of extractNamedFunctions(script.code).keys()) {
      const entry = index.get(name) ?? [];
      entry.push({
        source: script.code,
        fonte: "inline",
        lineOffset: script.lineOffset,
      });
      index.set(name, entry);
    }
  }

  return index;
}

function findFunctionSource(
  funcName: string,
  index: Map<string, FunctionSource[]>,
  logger: Logger
): FunctionSource | null {
  const matches = index.get(funcName);
  if (!matches || matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    const fontes = matches.map((m) => m.fonte).join(", ");
    logger.warn(
      `Função ${funcName} encontrada em múltiplas fontes (${fontes}); usando ${matches[0].fonte}.`
    );
  }

  return matches[0];
}

export function runPipeline(
  sources: Map<string, string>,
  options: {
    inlineScripts?: InlineScript[];
    assetUrls?: string[];
    logger?: Logger;
  } = {}
): PipelineResult {
  const inlineScripts = options.inlineScripts ?? [];
  const assetUrls =
    options.assetUrls ?? [VALIDADOR_URL, ...Array.from(sources.keys())];
  const logger = options.logger ?? noopLogger;

  const functionIndex = buildFunctionIndex(sources, inlineScripts);
  const rulesByLayout: Record<string, ReturnType<typeof mapToDsl>[]> = {};
  const camposByLayout: Record<string, CampoDominio[]> = {};

  for (const [funcName, layout] of Object.entries(MAPEAMENTO_FUNCOES)) {
    if (
      !LAYOUTS_DO_CICLO.includes(layout as (typeof LAYOUTS_DO_CICLO)[number])
    ) {
      continue;
    }

    const found = findFunctionSource(funcName, functionIndex, logger);
    if (!found) {
      logger.warn(`Função não encontrada: ${funcName}`);
      continue;
    }

    const familia = FAMILIA_POR_FUNCAO[funcName as keyof typeof FAMILIA_POR_FUNCAO];

    // O arquivo de retorno não tem a forma "condição → mensagem": é dicionário.
    if (MODO_POR_FUNCAO[funcName as keyof typeof MODO_POR_FUNCAO] === "tabelas") {
      const tabelas = extrairTabelasDeDominio(found.source, funcName, found.lineOffset);
      const campos = mapearCampos(tabelas, layout, funcName, familia);
      camposByLayout[layout] = camposByLayout[layout] ?? [];
      camposByLayout[layout].push(...campos);
      rulesByLayout[layout] = rulesByLayout[layout] ?? [];
      const entradas = campos.reduce((soma, c) => soma + c.entradas.length, 0);
      logger.log(`${funcName}: ${campos.length} campos (${entradas} códigos) -> ${layout}`);
      continue;
    }

    const rawRules = extractRulesFromFunction(
      found.source,
      funcName,
      found.lineOffset,
      familia
    );
    const dslRules = rawRules.map((r) => mapToDsl(r, layout, logger));
    rulesByLayout[layout] = rulesByLayout[layout] ?? [];
    rulesByLayout[layout].push(...dslRules);
    logger.log(`${funcName}: ${dslRules.length} regras -> ${layout}`);
  }

  return { assetUrls, sources, rulesByLayout, camposByLayout };
}

export async function main(): Promise<MainResult> {
  mkdirSync(ASSETS_DIR, { recursive: true });

  console.log(`Baixando ${VALIDADOR_URL}...`);
  const html = await downloadText(VALIDADOR_URL);
  const htmlPath = join(ASSETS_DIR, "validadorgeral.html");
  writeFileSync(htmlPath, html, "utf-8");

  const scriptUrls = extractScriptUrls(html, VALIDADOR_URL);
  console.log(`Encontrados ${scriptUrls.length} scripts externos.`);

  const sources = new Map<string, string>();
  for (const url of scriptUrls) {
    const content = await downloadText(url);
    const path = await saveAsset(url, content, ASSETS_DIR);
    sources.set(url, content);
    console.log(`Salvo: ${path}`);
  }

  const inlineScripts = extractInlineScripts(html);

  const assetUrls = [VALIDADOR_URL, ...sources.keys()];
  const pipeline = runPipeline(sources, {
    inlineScripts,
    assetUrls,
    logger: consoleLogger,
  });
  writeSpecs(SPECS_DIR, pipeline.rulesByLayout, pipeline.camposByLayout);
  console.log(`Specs escritos em ${SPECS_DIR}`);

  const baselineSha256 = writeBaseline([html, ...sources.values()], assetUrls);
  checkBaselineVersioned(baselineSha256);

  return {
    baselineSha256,
    rulesByLayout: pipeline.rulesByLayout,
    camposByLayout: pipeline.camposByLayout,
  };
}

function checkBaselineVersioned(downloadedSha256: string): void {
  try {
    const baselineContent = readFileSync(BASELINE_PATH, "utf-8");
    const baseline = JSON.parse(baselineContent) as { sha256?: string };
    if (baseline.sha256 && baseline.sha256 !== downloadedSha256) {
      console.warn(
        `[baseline] Divergência detectada: corpus baixado (${downloadedSha256}) difere do baseline versionado (${baseline.sha256}). O validador do banco pode ter sido atualizado.`
      );
    }
  } catch {
    console.warn("[baseline] Não foi possível ler o baseline versionado; pulando comparação.");
  }
}

function writeBaseline(contents: string[], urls: string[]): string {
  const hash = createHash("sha256");
  for (const c of contents) hash.update(c);
  const baseline = {
    sha256: hash.digest("hex"),
    fontes: urls,
  };
  writeFileSync(
    join(ASSETS_DIR, "baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n"
  );
  console.log(`Baseline SHA-256: ${baseline.sha256}`);
  return baseline.sha256;
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
