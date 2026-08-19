import { describe, it, expect } from "bun:test";
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
});
