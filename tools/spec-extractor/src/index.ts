import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  ASSETS_DIR,
  LAYOUTS_DO_CICLO,
  MAPEAMENTO_FUNCOES,
  SPECS_DIR,
  VALIDADOR_URL,
} from "./config.js";
import {
  downloadText,
  extractInlineScripts,
  extractScriptUrls,
  saveAsset,
} from "./downloader.js";
import { extractNamedFunctions } from "./inline-parser.js";
import { extractRulesFromFunction } from "./ast-walker.js";
import { mapToDsl } from "./rule-mapper.js";
import { writeSpecs } from "./spec-generator.js";

export interface MainResult {
  baselineSha256: string;
  rulesByLayout: Record<string, ReturnType<typeof mapToDsl>[]>;
}

export interface PipelineResult {
  html: string;
  assetUrls: string[];
  sources: Map<string, string>;
  rulesByLayout: Record<string, ReturnType<typeof mapToDsl>[]>;
}

function findFunctionSource(
  funcName: string,
  sources: Map<string, string>,
  inlineFunctions: Map<string, string>
): { source: string; fonte: string } | null {
  const matches: { source: string; fonte: string }[] = [];

  for (const [url, content] of sources) {
    const fns = extractNamedFunctions(content);
    if (fns.has(funcName)) {
      // Retorna o arquivo completo para preservar a rastreabilidade de linha
      // no relatório (linha_fonte relativa ao arquivo original, não à fatia).
      matches.push({ source: content, fonte: url });
    }
  }

  if (inlineFunctions.has(funcName)) {
    matches.push({ source: inlineFunctions.get(funcName)!, fonte: "inline" });
  }

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    const fontes = matches.map((m) => m.fonte).join(", ");
    console.warn(
      `Função ${funcName} encontrada em múltiplas fontes (${fontes}); usando ${matches[0].fonte}.`
    );
  }

  return matches[0];
}

export function runPipeline(
  html: string,
  sources: Map<string, string>,
  options: { inlineFunctions?: Map<string, string>; assetUrls?: string[] } = {}
): PipelineResult {
  const inlineFunctions = options.inlineFunctions ?? new Map<string, string>();
  const assetUrls =
    options.assetUrls ?? [VALIDADOR_URL, ...Array.from(sources.keys())];

  const rulesByLayout: Record<string, ReturnType<typeof mapToDsl>[]> = {};

  for (const [funcName, layout] of Object.entries(MAPEAMENTO_FUNCOES)) {
    if (
      !LAYOUTS_DO_CICLO.includes(layout as (typeof LAYOUTS_DO_CICLO)[number])
    ) {
      continue;
    }

    const found = findFunctionSource(funcName, sources, inlineFunctions);
    if (!found) {
      console.warn(`Função não encontrada: ${funcName}`);
      continue;
    }

    const rawRules = extractRulesFromFunction(found.source, funcName);
    const dslRules = rawRules.map((r) => mapToDsl(r, layout));
    rulesByLayout[layout] = rulesByLayout[layout] ?? [];
    rulesByLayout[layout].push(...dslRules);
    console.log(`${funcName}: ${dslRules.length} regras -> ${layout}`);
  }

  return { html, assetUrls, sources, rulesByLayout };
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
  const inlineFunctions = new Map<string, string>();
  for (const script of inlineScripts) {
    for (const [name, body] of extractNamedFunctions(script)) {
      inlineFunctions.set(name, body);
    }
  }

  const pipeline = runPipeline(html, sources, {
    inlineFunctions,
    assetUrls: [VALIDADOR_URL, ...scriptUrls],
  });
  writeSpecs(SPECS_DIR, pipeline.rulesByLayout);
  console.log(`Specs escritos em ${SPECS_DIR}`);

  const baselineSha256 = writeBaseline(
    [html, ...sources.values()],
    pipeline.assetUrls
  );

  return { baselineSha256, rulesByLayout: pipeline.rulesByLayout };
}

function writeBaseline(contents: string[], urls: string[]): string {
  const hash = createHash("sha256");
  for (const c of contents) hash.update(c);
  const baseline = {
    data: new Date().toISOString(),
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
