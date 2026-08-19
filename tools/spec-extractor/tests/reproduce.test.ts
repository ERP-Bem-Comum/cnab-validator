import { describe, it, expect } from "bun:test";
import { runReproducibilityCheck } from "../src/reproduce.js";

describe("runReproducibilityCheck", () => {
  it("passa sem diffs para o fixture versionado", () => {
    const result = runReproducibilityCheck();
    expect(result.ok).toBe(true);
    expect(result.diffs).toHaveLength(0);
    expect(result.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
