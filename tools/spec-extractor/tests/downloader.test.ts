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

  it("retries on HTTP 500 and returns eventual success", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      if (calls === 1) {
        return { text: async () => "error", status: 500, ok: false } as Response;
      }
      return { text: async () => "ok", status: 200, ok: true } as Response;
    }) as unknown as typeof fetch;

    const result = await downloadText("http://example.com", { retries: 1 });
    assert.strictEqual(result, "ok");
    assert.strictEqual(calls, 2);
  });

  it("retries on network TypeError and returns eventual success", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      if (calls === 1) {
        throw new TypeError("fetch failed");
      }
      return { text: async () => "ok", status: 200, ok: true } as Response;
    }) as unknown as typeof fetch;

    const result = await downloadText("http://example.com", { retries: 1 });
    assert.strictEqual(result, "ok");
    assert.strictEqual(calls, 2);
  });

  it("does not retry on HTTP 404", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      return { text: async () => "Not found", status: 404, ok: false } as Response;
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => downloadText("http://example.com/missing", { retries: 1 }),
      /HTTP 404/
    );
    assert.strictEqual(calls, 1);
  });

  it("does not retry on non-network TypeError", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      throw new TypeError("cannot read property of undefined");
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => downloadText("http://example.com", { retries: 1 }),
      /cannot read property of undefined/
    );
    assert.strictEqual(calls, 1);
  });

  it("does not let HTTP 500 status pollute retry decision for a later TypeError", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      if (calls === 1) {
        return { text: async () => "error", status: 500, ok: false } as Response;
      }
      throw new TypeError("cannot read property of undefined");
    }) as unknown as typeof fetch;

    await assert.rejects(
      () => downloadText("http://example.com", { retries: 1 }),
      /cannot read property of undefined/
    );
    assert.strictEqual(calls, 2);
  });

  it("retries on 408 Request Timeout", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      if (calls === 1) {
        return { text: async () => "timeout", status: 408, ok: false } as Response;
      }
      return { text: async () => "ok", status: 200, ok: true } as Response;
    }) as unknown as typeof fetch;

    const result = await downloadText("http://example.com", { retries: 1 });
    assert.strictEqual(result, "ok");
    assert.strictEqual(calls, 2);
  });

  it("retries on 429 Too Many Requests", async () => {
    let calls = 0;
    global.fetch = mock(async () => {
      calls++;
      if (calls === 1) {
        return { text: async () => "rate limited", status: 429, ok: false } as Response;
      }
      return { text: async () => "ok", status: 200, ok: true } as Response;
    }) as unknown as typeof fetch;

    const result = await downloadText("http://example.com", { retries: 1 });
    assert.strictEqual(result, "ok");
    assert.strictEqual(calls, 2);
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
      inline: [{ code: 'console.log("inline")', lineOffset: 2 }],
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
    assert.deepStrictEqual(scripts, [
      { code: "var x = 1;", lineOffset: 2 },
      { code: "function run() {}", lineOffset: 3 },
    ]);
  });

  it("returns empty array when no inline scripts exist", () => {
    const html = '<script src="/external.js"></script>';
    assert.deepStrictEqual(extractInlineScripts(html), []);
  });

  it("ignores non-executable script types", () => {
    const html = `
      <script type="application/json">{"x":1}</script>
      <script type="text/template"><div></div></script>
      <script>var ok = 1;</script>
    `;
    const scripts = extractInlineScripts(html);
    assert.deepStrictEqual(scripts, [{ code: "var ok = 1;", lineOffset: 3 }]);
  });

  it("handles uppercase attributes", () => {
    const html = `
      <SCRIPT SRC="/external.js"></SCRIPT>
      <SCRIPT>var up = 1;</SCRIPT>
    `;
    const scripts = extractInlineScripts(html);
    assert.deepStrictEqual(scripts, [{ code: "var up = 1;", lineOffset: 2 }]);
  });

  it("lineOffset reflects code line, not script tag line", () => {
    const html = `<html>
<script>
var x = 1;
</script>
<script
  type="text/javascript">
  var y = 2;
</script>
</html>`;
    const scripts = extractInlineScripts(html);
    assert.deepStrictEqual(scripts, [
      // <script> is on line 2; the script content starts on line 3 in the HTML.
      // Parser sees "\nvar x = 1;\n", so var x=1 is at loc.start.line=2.
      // absoluteLine = astLine + lineOffset, where lineOffset is the number of
      // newlines before the start of the script content. Hence 3 = 2 + 1.
      { code: "\nvar x = 1;\n", lineOffset: 1 },
      // Multi-line tag: tag starts line 5, attribute on line 6, content on line 7.
      // Parser sees "\n  var y = 2;\n", so var y=2 is at loc.start.line=2.
      // lineOffset counts the 5 newlines before the content, hence 7 = 2 + 5.
      { code: "\n  var y = 2;\n", lineOffset: 5 },
    ]);
  });

  it("does not confuse data-src with src", () => {
    const html = `<script data-src="/external.js">var inline = 1;</script>`;
    const scripts = extractInlineScripts(html);
    assert.deepStrictEqual(scripts, [{ code: "var inline = 1;", lineOffset: 0 }]);
  });

  it("does not confuse data-type with type", () => {
    const html = `<script data-type="application/json">var ok = 1;</script>`;
    const scripts = extractInlineScripts(html);
    assert.deepStrictEqual(scripts, [{ code: "var ok = 1;", lineOffset: 0 }]);
  });

  it("accepts executable script types case-insensitively", () => {
    const html = `
      <script type="TEXT/JAVASCRIPT">var a = 1;</script>
      <script type="Module">var b = 2;</script>
    `;
    const scripts = extractInlineScripts(html);
    assert.deepStrictEqual(scripts, [
      { code: "var a = 1;", lineOffset: 1 },
      { code: "var b = 2;", lineOffset: 2 },
    ]);
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
