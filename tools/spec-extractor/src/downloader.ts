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

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function isRetryableError(err: Error, status?: number): boolean {
  if (status !== undefined) {
    return RETRYABLE_STATUS_CODES.has(status);
  }
  return (
    err.name === "AbortError" ||
    /^(fetch failed|network error|getaddrinfo\b)|\b(ECONNREFUSED|ETIMEDOUT)\b/i.test(
      err.message
    )
  );
}

export async function downloadText(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  let lastError: Error | undefined;
  let lastStatus: number | undefined;
  let attemptsMade = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    lastStatus = undefined;
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
        lastStatus = response.status;
        throw new Error(`HTTP ${response.status} ao baixar ${url}`);
      }
      return await response.text();
    } catch (err) {
      attemptsMade = attempt + 1;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= retries || !isRetryableError(lastError, lastStatus)) {
        break;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `Falha ao baixar ${url} após ${attemptsMade} tentativa(s): ${lastError?.message}`
  );
}

export interface InlineScript {
  code: string;
  lineOffset: number;
}

export function parseScripts(html: string): {
  urls: string[];
  inline: InlineScript[];
} {
  // Usamos o parser HTML para URLs porque ele lida bem com atributos malformados.
  // Para scripts inline precisamos preservar a linha absoluta de cada código,
  // informação que o parser não expõe; por isso usamos regex aqui.
  const root = parse(html);
  const urls = root
    .querySelectorAll("script[src]")
    .map((s) => s.getAttribute("src"))
    .filter((src): src is string => !!src);

  const inline: InlineScript[] = [];
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const attrsRaw = match[1];
    const attrs = attrsRaw.toLowerCase();
    const code = match[2];

    // Ignora scripts externos. O \s garante que não confundamos data-src com src.
    if (/\ssrc\s*=/.test(attrs)) continue;

    // Ignora tipos não executáveis (json, template, etc.).
    const typeMatch = attrs.match(
      /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^ \s>]+))/
    );
    const type =
      typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? "";
    if (
      type &&
      !["text/javascript", "application/javascript", "module"].includes(
        type.toLowerCase()
      )
    ) {
      continue;
    }

    if (code.trim().length === 0) continue;
    const tagLineBreaks = (html.slice(0, match.index).match(/\n/g) ?? []).length;
    const attrLineBreaks = (attrsRaw.match(/\n/g) ?? []).length;
    const lineOffset = tagLineBreaks + attrLineBreaks;
    inline.push({ code, lineOffset });
  }

  return { urls, inline };
}

export function extractScriptUrls(html: string, baseUrl: string): string[] {
  const base = parseUrl(baseUrl, "base");
  const { urls } = parseScripts(html);
  return urls.map((src) => new URL(src, base.href).href);
}

export function extractInlineScripts(html: string): InlineScript[] {
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
