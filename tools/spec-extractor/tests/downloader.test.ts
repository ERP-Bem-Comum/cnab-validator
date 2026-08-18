import { describe, it, mock, beforeAll, afterAll } from "bun:test";
import assert from "node:assert";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadText,
  extractInlineScripts,
  extractScriptUrls,
  parseScripts,
  saveAsset,
} from "../src/downloader.js";

describe("downloadText", () => {
  const originalFetch = global.fetch;

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("returns text for a successful fetch", async () => {
    global.fetch = mock(async () =>
      Promise.resolve({
        text: async () => "<html></html>",
        status: 200,
        ok: true,
      } as Response)
    ) as unknown as typeof fetch;
    const result = await downloadText("http://example.com");
    assert.strictEqual(result, "<html></html>");
  });

  it("throws on HTTP error", async () => {
    global.fetch = mock(async () =>
      Promise.resolve({
        text: async () => "Not found",
        status: 404,
        ok: false,
      } as Response)
    ) as unknown as typeof fetch;

    await assert.rejects(
      () => downloadText("http://example.com/missing"),
      /HTTP 404/
    );
  });
});

describe("parseScripts", () => {
  it("returns both external and inline scripts", () => {
    const html = `
      <script src="/js/util.js"></script>
      <script>console.log("inline")</script>
      <script src="https://cdn.example.com/deps.js"></script>
    `;
    const result = parseScripts(html);
    assert.deepStrictEqual(result, {
      urls: ["/js/util.js", "https://cdn.example.com/deps.js"],
      inline: ['console.log("inline")'],
    });
  });

  it("returns empty arrays for empty input", () => {
    assert.deepStrictEqual(parseScripts(""), { urls: [], inline: [] });
  });
});

describe("extractScriptUrls", () => {
  it("finds relative and absolute script srcs", () => {
    const html = `
      <script src="/js/util.js"></script>
      <script src="https://cdn.example.com/deps.js"></script>
      <script>inline code</script>
    `;
    const urls = extractScriptUrls(html, "https://wspf.banco.bradesco/");
    assert.deepStrictEqual(urls, [
      "https://wspf.banco.bradesco/js/util.js",
      "https://cdn.example.com/deps.js",
    ]);
  });

  it("returns empty array for empty input", () => {
    assert.deepStrictEqual(extractScriptUrls("", "https://example.com/"), []);
  });

  it("throws on invalid base URL", () => {
    assert.throws(
      () => extractScriptUrls('<script src="x.js"></script>', "not-a-url"),
      /Invalid URL base/
    );
  });
});

describe("extractInlineScripts", () => {
  it("finds inline scripts", () => {
    const html = `
      <script src="/external.js"></script>
      <script>var x = 1;</script>
      <script>function run() {}</script>
    `;
    const scripts = extractInlineScripts(html);
    assert.deepStrictEqual(scripts, ["var x = 1;", "function run() {}"]);
  });

  it("returns empty array when no inline scripts exist", () => {
    const html = '<script src="/external.js"></script>';
    assert.deepStrictEqual(extractInlineScripts(html), []);
  });
});

describe("saveAsset", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "spec-extractor-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves content to a nested path under assetsDir", async () => {
    const filePath = await saveAsset(
      "https://example.com/js/util.js",
      "console.log('ok')",
      tempDir
    );
    assert.strictEqual(filePath, join(tempDir, "js", "util.js"));
    const content = await readFile(filePath, "utf-8");
    assert.strictEqual(content, "console.log('ok')");
  });

  it("throws when URL pathname contains directory traversal", async () => {
    await assert.rejects(
      () => saveAsset("https://example.com/%2E%2E%2Fsecret.js", "content", tempDir),
      /directory traversal/
    );
  });

  it("throws when URL pathname is a directory", async () => {
    await assert.rejects(
      () => saveAsset("https://example.com/", "content", tempDir),
      /URL pathname is a directory/
    );
  });

  it("throws on invalid URL", async () => {
    await assert.rejects(
      () => saveAsset("not-a-valid-url", "content", tempDir),
      /Invalid URL asset/
    );
  });
});
