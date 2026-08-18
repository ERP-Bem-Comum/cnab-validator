import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parse } from "node-html-parser";

export async function downloadText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ao baixar ${url}`);
  }
  return response.text();
}

export function extractScriptUrls(html: string, baseUrl: string): string[] {
  const root = parse(html);
  const scripts = root.querySelectorAll("script[src]");
  return scripts
    .map((s) => s.getAttribute("src"))
    .filter((src): src is string => !!src)
    .map((src) => new URL(src, baseUrl).href);
}

export function extractInlineScripts(html: string): string[] {
  const root = parse(html);
  return root
    .querySelectorAll("script")
    .map((s) => s.textContent)
    .filter((code) => code.trim().length > 0);
}

export async function saveAsset(
  url: string,
  content: string,
  assetsDir: string
): Promise<string> {
  const urlObj = new URL(url);
  const filePath = `${assetsDir}${urlObj.pathname}`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return filePath;
}
