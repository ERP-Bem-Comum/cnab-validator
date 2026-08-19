import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { runPipeline } from "./index.js";
import { writeSpecs } from "./spec-generator.js";

const FIXTURE_PATH = new URL("../tests/fixtures/corpus-fixture.js", import.meta.url);
const GOLDEN_DIR = new URL("../tests/fixtures/expected-specs", import.meta.url);
const FIXTURE_URL = "fixture://corpus-fixture.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function listJsonFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listJsonFiles(path));
    } else if (entry.name.endsWith(".json")) {
      result.push(path);
    }
  }
  return result.sort();
}

function relativize(base: string, path: string): string {
  return relative(base, path).replace(/\\/g, "/");
}

export function runReproducibilityCheck(): {
  fixtureSha256: string;
  ok: boolean;
  diffs: string[];
} {
  const fixtureCode = readFileSync(FIXTURE_PATH, "utf-8");
  const fixtureSha256 = sha256(fixtureCode);

  const sources = new Map<string, string>([[FIXTURE_URL, fixtureCode]]);
  const pipeline = runPipeline(sources, {
    assetUrls: [FIXTURE_URL],
  });

  const tmpDir = mkdtempSync(join(tmpdir(), "spec-repro-"));
  try {
    writeSpecs(tmpDir, pipeline.rulesByLayout, pipeline.camposByLayout);

    const goldenFiles = listJsonFiles(GOLDEN_DIR.pathname);
    const generatedFiles = listJsonFiles(tmpDir);

    const diffs: string[] = [];

    const goldenRelative = goldenFiles.map((p) => relativize(GOLDEN_DIR.pathname, p));
    const generatedRelative = generatedFiles.map((p) => relativize(tmpDir, p));

    if (goldenRelative.join("\n") !== generatedRelative.join("\n")) {
      diffs.push(
        `Conjunto de arquivos diverge. Esperado: [${goldenRelative.join(", ")}], gerado: [${generatedRelative.join(", ")}]`
      );
    }

    for (const rel of goldenRelative) {
      const goldenPath = join(GOLDEN_DIR.pathname, rel);
      const generatedPath = join(tmpDir, rel);
      // Arquivo que existe só de um lado é diferença a relatar, não exceção a
      // estourar: o gate precisa dizer o que mudou.
      if (!generatedRelative.includes(rel)) {
        diffs.push(`Arquivo ausente na geração: ${rel}`);
        continue;
      }
      const goldenContent = readFileSync(goldenPath, "utf-8");
      const generatedContent = readFileSync(generatedPath, "utf-8");
      if (goldenContent !== generatedContent) {
        diffs.push(`Diff em ${rel}: golden=${goldenContent.length}b, gerado=${generatedContent.length}b`);
      }
    }

    return { fixtureSha256, ok: diffs.length === 0, diffs };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { fixtureSha256, ok, diffs } = runReproducibilityCheck();
  console.log(`Fixture SHA-256: ${fixtureSha256}`);
  if (!ok) {
    console.error("Falha de reprodutibilidade:");
    for (const d of diffs) {
      console.error(`  - ${d}`);
    }
    process.exit(1);
  }
  console.log("Reprodutibilidade verificada com sucesso.");
}
