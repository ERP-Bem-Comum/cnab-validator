import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffSummary } from "../src/diff-summary.js";

describe("diffSummary", () => {
  it("reporta nenhuma alteração quando os specs são idênticos", () => {
    const result = diffSummary(
      "tests/fixtures/expected-specs",
      "tests/fixtures/expected-specs"
    );
    expect(result.hasChanges).toBe(false);
    expect(result.totalChanges).toBe(0);
  });

  it("trata base sem specs como spec vazio, não como erro", () => {
    // Acontece em PR contra um branch onde `tools/specs/` ainda não existe:
    // o resumo deve reportar tudo como adicionado em vez de quebrar o job.
    const vazio = mkdtempSync(join(tmpdir(), "specs-vazio-"));
    try {
      const result = diffSummary(vazio, "tests/fixtures/expected-specs");
      expect(result.hasChanges).toBe(true);
      expect(result.totalChanges).toBeGreaterThan(0);
    } finally {
      rmSync(vazio, { recursive: true, force: true });
    }
  });
});
