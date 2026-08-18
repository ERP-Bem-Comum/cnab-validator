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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildFunctionPattern(funcName: string): RegExp {
  const esc = escapeRegExp(funcName);
  return new RegExp(
    `(?:function\\s+${esc}|\\b${esc}\\s*=\\s*(?:function|\\(.*\\)\\s*=>))`
  );
}

async function main() {
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

  const assetUrls = [VALIDADOR_URL, ...scriptUrls];

  const inlineScripts = extractInlineScripts(html);
  const inlineFunctions = new Map<string, string>();
  for (const script of inlineScripts) {
    for (const [name, body] of extractNamedFunctions(script)) {
      inlineFunctions.set(name, body);
    }
  }

  const rulesByLayout: Record<string, ReturnType<typeof mapToDsl>[]> = {};

  for (const [funcName, layout] of Object.entries(MAPEAMENTO_FUNCOES)) {
    if (!LAYOUTS_DO_CICLO.includes(layout as (typeof LAYOUTS_DO_CICLO)[number])) continue;

    const pattern = buildFunctionPattern(funcName);
    let source = "";
    for (const content of sources.values()) {
      if (pattern.test(content)) {
        source = content;
        break;
      }
    }
    if (!source && inlineFunctions.has(funcName)) {
      source = inlineFunctions.get(funcName)!;
    }
    if (!source) {
      console.warn(`Função não encontrada: ${funcName}`);
      continue;
    }

    const rawRules = extractRulesFromFunction(source, funcName);
    const dslRules = rawRules.map((r) => mapToDsl(r, layout));
    rulesByLayout[layout] = rulesByLayout[layout] ?? [];
    rulesByLayout[layout].push(...dslRules);
    console.log(`${funcName}: ${dslRules.length} regras -> ${layout}`);
  }

  writeSpecs(SPECS_DIR, rulesByLayout);
  console.log(`Specs escritos em ${SPECS_DIR}`);

  writeBaseline([html, ...sources.values()], assetUrls);
}

function writeBaseline(contents: string[], urls: string[]) {
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
