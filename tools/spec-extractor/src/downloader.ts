import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { parse } from "node-html-parser";

function parseUrl(url: string, context: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(`Invalid URL ${context}: ${url}`);
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;

export async function downloadText(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ao baixar ${url}`);
      }
      return await response.text();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        console.warn(`Tentativa ${attempt + 1} falhou para ${url}; tentando novamente...`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Falha ao baixar ${url} após ${retries + 1} tentativa(s): ${lastError?.message}`);
}

export function parseScripts(html: string): { urls: string[]; inline: string[] } {
  const root = parse(html);
  const urls = root
    .querySelectorAll("script[src]")
    .map((s) => s.getAttribute("src"))
    .filter((src): src is string => !!src);
  const inline = root
    .querySelectorAll("script")
    .map((s) => s.textContent)
    .filter((code) => code.trim().length > 0);
  return { urls, inline };
}

export function extractScriptUrls(html: string, baseUrl: string): string[] {
  const base = parseUrl(baseUrl, "base");
  const { urls } = parseScripts(html);
  return urls.map((src) => new URL(src, base.href).href);
}

export function extractInlineScripts(html: string): string[] {
  return parseScripts(html).inline;
}

export async function saveAsset(
  url: string,
  content: string,
  assetsDir: string
): Promise<string> {
  const urlObj = parseUrl(url, "asset");

  let pathname: string;
  try {
    pathname = decodeURIComponent(urlObj.pathname);
  } catch {
    throw new Error(`URL pathname contains invalid percent-encoding: ${url}`);
  }

  if (pathname === "/" || pathname.endsWith("/")) {
    throw new Error(`URL pathname is a directory: ${url}`);
  }

  const relativePath = pathname.replace(/^\/+/, "");
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`URL pathname contains directory traversal: ${url}`);
  }

  const filePath = join(assetsDir, ...segments);
  const relToAssets = relative(assetsDir, filePath);
  if (relToAssets.startsWith("..") || relToAssets === "..") {
    throw new Error(`Resolved path escapes assets dir: ${filePath}`);
  }

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf-8");
  return filePath;
}
