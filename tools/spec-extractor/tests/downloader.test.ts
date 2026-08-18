import { describe, it, mock } from "bun:test";
import assert from "node:assert";
import { downloadText, extractScriptUrls } from "../src/downloader.js";

describe("downloadText", () => {
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
});
