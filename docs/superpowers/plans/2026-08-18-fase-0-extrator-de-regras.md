# Fase 0 — Extrator de Regras Bradesco (AST)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar um extrator Bun/TypeScript que baixa os assets públicos do validador Bradesco, parseia o JavaScript via AST (acorn) e gera os arquivos `specs/index.json` e `specs/layouts/*.json` com as regras de validação estrutural.

**Architecture:** O extrator é dividido em downloader (HTTP), parser de HTML (scripts inline), AST walker (acorn) e gerador de JSON. Cada regra extraída é mapeada para um tipo da DSL (`literal_fixo`, `numerico_branco`, `dominio`, `modulo_11`, `coerencia_registro`, `custom`).

**Tech Stack:** Bun 1.1+, TypeScript (rodado nativamente pelo Bun), `acorn`, `acorn-walk`, `node-html-parser`. Bun substitui Node.js nesta fase por performance e ergonomia com Rust/Zig.

---

## File Structure

```
tools/spec-extractor/
├── package.json
├── src/
│   ├── index.ts                    # CLI principal + baseline SHA-256
│   ├── config.ts                   # URLs, layouts do ciclo, constantes
│   ├── downloader.ts               # download de HTML e assets JS
│   ├── inline-parser.ts            # extrai scripts inline do HTML
│   ├── ast-walker.ts               # caminha na AST e extrai regras brutas
│   ├── rule-mapper.ts              # mapeia condições AST -> DSL JSON
│   └── spec-generator.ts           # grava specs/index.json e layouts/*.json
├── tests/
│   ├── fixtures/
│   │   ├── sample-cobranca.js      # trecho mínimo de validarDadosArquivo240
│   │   └── sample-condicoes.js     # exemplos dos 5 arquétipos de regra
│   ├── downloader.test.ts
│   ├── inline-parser.test.ts
│   ├── ast-walker.test.ts
│   └── rule-mapper.test.ts
└── tsconfig.json
```

---

### Task 1: Bootstrap do projeto Bun

**Files:**
- Create: `tools/spec-extractor/package.json`
- Create: `tools/spec-extractor/tsconfig.json`
- Create: `tools/spec-extractor/.gitignore`
- Create: `tools/spec-extractor/src/config.ts`

- [ ] **Step 1: Criar `package.json` com dependências**

```json
{
  "name": "bradesco-spec-extractor",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "bun run src/index.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "acorn": "^8.12.1",
    "acorn-walk": "^8.3.4",
    "node-html-parser": "^6.1.13"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 3: Criar `.gitignore`**

```text
node_modules/
dist/
assets/
```

- [ ] **Step 4: Criar `src/config.ts` com URLs e layouts do ciclo**

```typescript
export const VALIDADOR_URL =
  "https://wspf.banco.bradesco/wsValidadorUniversal/validadorgeral";

export const ASSETS_DIR = "./assets";
export const SPECS_DIR = "../../specs";

export const LAYOUTS_DO_CICLO = [
  "cobranca-remessa",
  "multipag",
  "folha-pagamento",
] as const;

export const MAPEAMENTO_FUNCOES: Record<string, string> = {
  validarDadosArquivo240: "cobranca-remessa",
  validarDadosArquivo400: "cobranca-remessa",
  validarDadosMultipag: "multipag",
  validarDadosFolha240: "folha-pagamento",
  validarDadosFolha200: "folha-pagamento",
};
```

- [ ] **Step 5: Instalar dependências com Bun**

Run: `cd tools/spec-extractor && bun install`

Expected: cria `node_modules/` e `bun.lockb`.

- [ ] **Step 6: Commit**

```bash
git add tools/spec-extractor/package.json tools/spec-extractor/tsconfig.json tools/spec-extractor/.gitignore tools/spec-extractor/src/config.ts tools/spec-extractor/bun.lockb
git commit -m "chore: bootstrap do extrator de regras com Bun"
```

---

### Task 2: Downloader de assets

**Files:**
- Create: `tools/spec-extractor/src/downloader.ts`
- Create: `tools/spec-extractor/tests/downloader.test.ts`

- [ ] **Step 1: Escrever teste de download com mock**

Create `tools/spec-extractor/tests/downloader.test.ts`:

```typescript
import { describe, it, mock } from "bun:test";
import assert from "node:assert";
import { downloadText, extractScriptUrls } from "../src/downloader.js";

describe("downloadText", () => {
  it("returns text for a successful fetch", async () => {
    global.fetch = mock.fn(async () =>
      Promise.resolve({
        text: async () => "<html></html>",
        status: 200,
      } as Response)
    );
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
```

- [ ] **Step 2: Rodar teste para confirmar que falha**

Run: `cd tools/spec-extractor && bun test`

Expected: FAIL — `downloadText` and `extractScriptUrls` not defined.

- [ ] **Step 3: Implementar `src/downloader.ts`**

```typescript
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
```

- [ ] **Step 4: Rodar testes para confirmar que passam**

Run: `cd tools/spec-extractor && bun test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/spec-extractor/src/downloader.ts tools/spec-extractor/tests/downloader.test.ts
git commit -m "feat: downloader de assets HTML/JS"
```

---

### Task 3: Extrator de scripts inline

**Files:**
- Create: `tools/spec-extractor/src/inline-parser.ts`
- Create: `tools/spec-extractor/tests/inline-parser.test.ts`

- [ ] **Step 1: Escrever teste para extração de função inline**

Create `tools/spec-extractor/tests/inline-parser.test.ts`:

```typescript
import { describe, it } from "bun:test";
import assert from "node:assert";
import { extractNamedFunctions } from "../src/inline-parser.js";

describe("extractNamedFunctions", () => {
  it("captures function declarations and assignments", () => {
    const code = `
      function obterValorCNPJAlfanumerico(v) { return v.trim(); }
      var helper = function(x) { return x; };
    `;
    const functions = extractNamedFunctions(code);
    assert.strictEqual(functions.has("obterValorCNPJAlfanumerico"), true);
    assert.strictEqual(functions.get("obterValorCNPJAlfanumerico")?.includes("trim"), true);
  });
});
```

- [ ] **Step 2: Rodar teste para confirmar que falha**

Run: `cd tools/spec-extractor && bun test`

Expected: FAIL — `extractNamedFunctions` not defined.

- [ ] **Step 3: Implementar `src/inline-parser.ts`**

```typescript
import { parse } from "acorn";
import { simple } from "acorn-walk";

export function extractNamedFunctions(code: string): Map<string, string> {
  const ast = parse(code, { ecmaVersion: "latest" });
  const functions = new Map<string, string>();

  simple(ast, {
    FunctionDeclaration(node: any) {
      if (node.id && node.id.name) {
        functions.set(node.id.name, code.slice(node.start, node.end));
      }
    },
    VariableDeclarator(node: any) {
      if (
        node.id &&
        node.id.name &&
        node.init &&
        ["FunctionExpression", "ArrowFunctionExpression"].includes(node.init.type)
      ) {
        functions.set(node.id.name, code.slice(node.init.start, node.init.end));
      }
    },
  });

  return functions;
}
```

- [ ] **Step 4: Rodar testes para confirmar que passam**

Run: `cd tools/spec-extractor && bun test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/spec-extractor/src/inline-parser.ts tools/spec-extractor/tests/inline-parser.test.ts
git commit -m "feat: parser de funcoes inline do HTML"
```

---

### Task 4: AST Walker para extrair regras

**Files:**
- Create: `tools/spec-extractor/src/ast-walker.ts`
- Create: `tools/spec-extractor/tests/fixtures/sample-cobranca.js`
- Create: `tools/spec-extractor/tests/ast-walker.test.ts`

- [ ] **Step 1: Criar fixture com trecho mínimo de regras**

Create `tools/spec-extractor/tests/fixtures/sample-cobranca.js`:

```javascript
function validarDadosArquivo240(res) {
  var str = "";
  if (res[0].substring(3, 7) != "0000") {
    str += "Linha 1, colunas 004 a 007, Header de arquivo, não contém número de lote 0000.<br>";
  }
  if (res[0].substring(142, 143) != "1") {
    str += "Linha 1, coluna 143, Header de arquivo, Tipo de inscrição inválido.<br>";
  }
  for (var i = 1; i < res.length - 1; i++) {
    if (res[i].substring(13, 14) != "P") {
      str += "Linha " + (i + 1) + ", coluna 014, Segmento P, inválido.<br>";
    }
  }
  return str;
}
```

- [ ] **Step 2: Escrever teste do walker**

Create `tools/spec-extractor/tests/ast-walker.test.ts`:

```typescript
import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extractRulesFromFunction } from "../src/ast-walker.js";

const fixture = readFileSync(
  new URL("./fixtures/sample-cobranca.js", import.meta.url),
  "utf-8"
);

describe("extractRulesFromFunction", () => {
  it("extracts three structural rules", () => {
    const rules = extractRulesFromFunction(fixture, "validarDadosArquivo240");
    assert.strictEqual(rules.length, 3);
    assert.strictEqual(rules[0].registro, "header-arquivo");
    assert.strictEqual(rules[0].condicao_original, 'res[0].substring(3, 7) != "0000"');
    assert.deepStrictEqual(rules[1].colunas, [143, 143]);
    assert.strictEqual(rules[2].registro, "segmento-p");
  });
});
```

- [ ] **Step 3: Rodar teste para confirmar que falha**

Run: `cd tools/spec-extractor && bun test`

Expected: FAIL — `extractRulesFromFunction` not defined.

- [ ] **Step 4: Implementar `src/ast-walker.ts` (esqueleto)**

```typescript
import { parse } from "acorn";
import { simple } from "acorn-walk";

export interface RawRule {
  funcao_origem: string;
  linha_fonte: number;
  condicao_original: string;
  mensagem: string;
  registro: string;
  colunas: [number, number];
  alvo: string;
}

export function extractRulesFromFunction(
  code: string,
  functionName: string
): RawRule[] {
  const ast = parse(code, { ecmaVersion: "latest", locations: true });
  const rules: RawRule[] = [];

  simple(ast, {
    FunctionDeclaration(node: any) {
      if (node.id?.name !== functionName) return;
      for (const stmt of node.body.body) {
        visitStatement(stmt, code, functionName, rules);
      }
    },
  });

  return rules;
}

function visitStatement(
  stmt: any,
  code: string,
  functionName: string,
  rules: RawRule[]
): void {
  if (stmt.type === "IfStatement") {
    const message = extractConcatenatedMessage(stmt.consequent, code);
    if (message) {
      rules.push({
        funcao_origem: functionName,
        linha_fonte: stmt.loc?.start.line ?? 0,
        condicao_original: code.slice(stmt.test.start, stmt.test.end),
        mensagem: message,
        registro: inferirRegistro(message),
        colunas: extrairColunas(message),
        alvo: extrairAlvo(stmt.test),
      });
    }
    if (stmt.alternate) {
      visitStatement(stmt.alternate, code, functionName, rules);
    }
  }
  if (stmt.type === "ForStatement" || stmt.type === "WhileStatement") {
    for (const inner of stmt.body.body ?? []) {
      visitStatement(inner, code, functionName, rules);
    }
  }
  if (stmt.type === "BlockStatement") {
    for (const inner of stmt.body) {
      visitStatement(inner, code, functionName, rules);
    }
  }
}

function extractConcatenatedMessage(stmt: any, code: string): string | null {
  if (stmt.type === "BlockStatement") {
    for (const inner of stmt.body) {
      const msg = extractConcatenatedMessage(inner, code);
      if (msg) return msg;
    }
  }
  if (stmt.type === "ExpressionStatement" && stmt.expression.type === "AssignmentExpression") {
    const right = stmt.expression.right;
    if (right.type === "BinaryExpression" && right.operator === "+") {
      return extractStringFromExpression(right, code);
    }
  }
  return null;
}

function extractStringFromExpression(expr: any, code: string): string {
  if (expr.type === "Literal" && typeof expr.value === "string") {
    return expr.value;
  }
  if (expr.type === "BinaryExpression" && expr.operator === "+") {
    return (
      extractStringFromExpression(expr.left, code) +
      extractStringFromExpression(expr.right, code)
    );
  }
  return "";
}

function inferirRegistro(mensagem: string): string {
  const lower = mensagem.toLowerCase();
  if (lower.includes("header de arquivo")) return "header-arquivo";
  if (lower.includes("header de lote")) return "header-lote";
  if (lower.includes("segmento p")) return "segmento-p";
  if (lower.includes("segmento q")) return "segmento-q";
  if (lower.includes("segmento r")) return "segmento-r";
  if (lower.includes("trailer de lote")) return "trailer-lote";
  if (lower.includes("trailer de arquivo")) return "trailer-arquivo";
  return "nao-classificado";
}

function extrairColunas(mensagem: string): [number, number] {
  const match = mensagem.match(/colunas?\s+(\d+)\s+a\s+(\d+)/i);
  if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
  const single = mensagem.match(/coluna\s+(\d+)/i);
  if (single) {
    const n = parseInt(single[1], 10);
    return [n, n];
  }
  return [0, 0];
}

function extrairAlvo(test: any): string {
  // heurística: identifica res[0], res[i], res[i+1], etc.
  const code = JSON.stringify(test);
  const match = code.match(/res\[(\d+|[^\]]+)\]/);
  return match ? match[0] : "res[0]";
}
```

- [ ] **Step 5: Rodar testes para confirmar que passam**

Run: `cd tools/spec-extractor && bun test`

Expected: PASS (com ajustes pontuais se a regex de colunas precisar de fine-tuning).

- [ ] **Step 6: Commit**

```bash
git add tools/spec-extractor/src/ast-walker.ts tools/spec-extractor/tests/ast-walker.test.ts tools/spec-extractor/tests/fixtures/sample-cobranca.js
git commit -m "feat: AST walker basico para extrair regras"
```

---

### Task 5: Mapeamento de condições para DSL JSON

**Files:**
- Create: `tools/spec-extractor/src/rule-mapper.ts`
- Create: `tools/spec-extractor/tests/fixtures/sample-condicoes.js`
- Create: `tools/spec-extractor/tests/rule-mapper.test.ts`

- [ ] **Step 1: Criar fixture com os 5 arquétipos**

Create `tools/spec-extractor/tests/fixtures/sample-condicoes.js`:

```javascript
function amostra(res) {
  var str = "";
  if (res[0].substring(3, 7) != "0000") {
    str += "Literal fixo invalido.<br>";
  }
  if (isNaN(res[0].substring(7, 11)) || res[0].substring(7, 11).replace(/\s/g, '').length != 0) {
    str += "Numerico/branco invalido.<br>";
  }
  if (res[0].substring(11, 13) != "01" && res[0].substring(11, 13) != "02" && res[0].substring(11, 13) != "03") {
    str += "Dominio invalido.<br>";
  }
  if (res[0].substring(13, 27) != calcularModulo11(res[0].substring(13, 27))) {
    str += "Modulo 11 invalido.<br>";
  }
  if (res[i].substring(0, 1) != res[i + 1].substring(0, 1)) {
    str += "Coerencia entre registros invalida.<br>";
  }
  return str;
}
```

- [ ] **Step 2: Escrever teste do rule-mapper**

Create `tools/spec-extractor/tests/rule-mapper.test.ts`:

```typescript
import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extractRulesFromFunction } from "../src/ast-walker.js";
import { mapToDsl } from "../src/rule-mapper.js";

const fixture = readFileSync(
  new URL("./fixtures/sample-condicoes.js", import.meta.url),
  "utf-8"
);

describe("mapToDsl", () => {
  it("classifica todos os arquetipos", () => {
    const raw = extractRulesFromFunction(fixture, "amostra");
    const rules = raw.map((r) => mapToDsl(r, "cobranca-remessa"));
    assert.strictEqual(rules[0].condicao.tipo, "literal_fixo");
    assert.strictEqual(rules[1].condicao.tipo, "numerico_branco");
    assert.strictEqual(rules[2].condicao.tipo, "dominio");
    assert.strictEqual(rules[3].condicao.tipo, "modulo_11");
    assert.strictEqual(rules[4].condicao.tipo, "coerencia_registro");
  });
});
```

- [ ] **Step 3: Rodar teste para confirmar que falha**

Run: `cd tools/spec-extractor && bun test`

Expected: FAIL — `mapToDsl` not defined.

- [ ] **Step 4: Implementar `src/rule-mapper.ts` (esqueleto)**

```typescript
import { parse } from "acorn";
import { simple } from "acorn-walk";
import type { RawRule } from "./ast-walker.js";

export interface DslCondition {
  tipo: string;
  alvo?: string;
  posicao?: { inicio0: number; fim0: number };
  operador?: string;
  valor?: string;
  valores?: string[];
  documento?: string;
  outro?: string;
}

export interface DslRule {
  id: string;
  funcao_origem: string;
  linha_fonte: number;
  registro: string;
  registro_alvo: string[];
  colunas: [number, number];
  posicoes: {
    alvo: string;
    inicio0: number;
    fim0: number;
    colunas: [number, number];
    tamanho: number;
  }[];
  condicao: DslCondition;
  condicao_original: string;
  descricao: string;
  mensagem: string;
  natureza: string;
  severidade: string;
}

export function mapToDsl(raw: RawRule, layout: string): DslRule {
  const condicao = inferirCondicao(raw.condicao_original, raw.alvo);
  const inicio0 = raw.colunas[0] > 0 ? raw.colunas[0] - 1 : 0;
  const fim0 = raw.colunas[1] > 0 ? raw.colunas[1] : inicio0 + 1;

  return {
    id: `${layout}:${raw.linha_fonte}`,
    funcao_origem: raw.funcao_origem,
    linha_fonte: raw.linha_fonte,
    registro: raw.registro,
    registro_alvo: [raw.alvo],
    colunas: raw.colunas,
    posicoes: [
      {
        alvo: raw.alvo,
        inicio0,
        fim0,
        colunas: raw.colunas,
        tamanho: fim0 - inicio0,
      },
    ],
    condicao,
    condicao_original: raw.condicao_original,
    descricao: raw.mensagem.replace(/<br>/g, "").trim(),
    mensagem: raw.mensagem.replace(/<br>/g, "").trim(),
    natureza: "validacao-estrutural",
    severidade: "erro",
  };
}

function inferirCondicao(condicaoOriginal: string, alvo: string): DslCondition {
  const ast = parse(condicaoOriginal, { ecmaVersion: "latest" });

  // Literal fixo: res[x].substring(a,b) != "valor"
  const literalMatch = condicaoOriginal.match(
    /(\w+)\[(\w+)\]\.substring\((\d+),\s*(\d+)\)\s*(!=|==)\s*"([^"]*)"/
  );
  if (literalMatch) {
    const [, , index, a, b, operador, valor] = literalMatch;
    return {
      tipo: "literal_fixo",
      alvo: `res[${index}]`,
      posicao: { inicio0: parseInt(a, 10), fim0: parseInt(b, 10) },
      operador,
      valor,
    };
  }

  // Numerico/branco: isNaN(...) || ...replace(/\s/g,'').length != 0
  if (condicaoOriginal.includes("isNaN")) {
    const m = condicaoOriginal.match(/substring\((\d+),\s*(\d+)\)/);
    if (m) {
      return {
        tipo: "numerico_branco",
        alvo,
        posicao: { inicio0: parseInt(m[1], 10), fim0: parseInt(m[2], 10) },
      };
    }
  }

  // Dominio: cadeia de != contra valores literais
  const dominioMatches = [...condicaoOriginal.matchAll(/"([^"]+)"/g)];
  if (dominioMatches.length >= 2 && condicaoOriginal.includes("&&")) {
    const m = condicaoOriginal.match(/substring\((\d+),\s*(\d+)\)/);
    if (m) {
      return {
        tipo: "dominio",
        alvo,
        posicao: { inicio0: parseInt(m[1], 10), fim0: parseInt(m[2], 10) },
        valores: dominioMatches.map((x) => x[1]),
      };
    }
  }

  // Modulo 11: substring(...) != calcularModulo11(...)
  if (condicaoOriginal.includes("calcularModulo11") || condicaoOriginal.includes("modulo11")) {
    const m = condicaoOriginal.match(/substring\((\d+),\s*(\d+)\)/);
    if (m) {
      return {
        tipo: "modulo_11",
        alvo,
        posicao: { inicio0: parseInt(m[1], 10), fim0: parseInt(m[2], 10) },
        documento: inferirDocumento(condicaoOriginal),
      };
    }
  }

  // Coerencia entre registros: res[i]... != res[i+1]...
  if (condicaoOriginal.includes("res[i + 1]") || condicaoOriginal.includes("res[i+1]")) {
    return {
      tipo: "coerencia_registro",
      alvo,
      outro: "res[i+1]",
    };
  }

  return { tipo: "custom", alvo };
}

function inferirDocumento(condicao: string): string {
  if (condicao.includes("CNPJ")) return "cnpj";
  if (condicao.includes("CPF")) return "cpf";
  if (condicao.includes("agencia")) return "agencia";
  if (condicao.includes("conta")) return "conta";
  return "desconhecido";
}
```

- [ ] **Step 5: Rodar testes para confirmar que passam**

Run: `cd tools/spec-extractor && bun test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/spec-extractor/src/rule-mapper.ts tools/spec-extractor/tests/rule-mapper.test.ts tools/spec-extractor/tests/fixtures/sample-condicoes.js
git commit -m "feat: mapeamento de condicoes AST para DSL JSON"
```

---

### Task 6: Gerador de specs JSON

**Files:**
- Create: `tools/spec-extractor/src/spec-generator.ts`
- Create: `tools/spec-extractor/tests/spec-generator.test.ts`

- [ ] **Step 1: Escrever teste do gerador**

Create `tools/spec-extractor/tests/spec-generator.test.ts`:

```typescript
import { describe, it } from "bun:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSpecs } from "../src/spec-generator.js";
import type { DslRule } from "../src/rule-mapper.js";

describe("writeSpecs", () => {
  it("writes index.json and layout files", () => {
    const dir = mkdtempSync(join(tmpdir(), "specs-"));
    const rule: DslRule = {
      id: "cobranca-remessa:117",
      funcao_origem: "validarDadosArquivo240",
      linha_fonte: 117,
      registro: "header-arquivo",
      registro_alvo: ["res[0]"],
      colunas: [4, 7],
      posicoes: [{ alvo: "res[0]", inicio0: 3, fim0: 7, colunas: [4, 7], tamanho: 4 }],
      condicao: { tipo: "literal_fixo", alvo: "res[0]", posicao: { inicio0: 3, fim0: 7 }, operador: "!=", valor: "0000" },
      condicao_original: 'res[0].substring(3, 7) != "0000"',
      descricao: "Header de arquivo, não contém número de lote 0000.",
      mensagem: "Linha 1, colunas 004 a 007, Header de arquivo, não contém número de lote 0000.",
      natureza: "validacao-estrutural",
      severidade: "erro",
    };

    writeSpecs(dir, { "cobranca-remessa": [rule] });

    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf-8"));
    assert.strictEqual(index.total_regras, 1);
    assert.strictEqual(index.layouts[0].layout, "cobranca-remessa");

    const layout = JSON.parse(readFileSync(join(dir, "layouts", "cobranca-remessa.json"), "utf-8"));
    assert.strictEqual(layout.regras.length, 1);

    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Rodar teste para confirmar que falha**

Run: `cd tools/spec-extractor && bun test`

Expected: FAIL — `writeSpecs` not defined.

- [ ] **Step 3: Implementar `src/spec-generator.ts`**

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DslRule } from "./rule-mapper.js";

export interface LayoutEntry {
  layout: string;
  nome: string;
  tipo: "remessa" | "retorno" | "infra";
  tamanhos_linha: number[];
  arquivo: string;
  total_regras: number;
  sub_layouts: {
    funcao: string;
    regras: number;
  }[];
}

export interface IndexSpec {
  fonte: string;
  extraido_em: string;
  observacao: string;
  total_regras: number;
  layouts: LayoutEntry[];
}

export interface LayoutSpec {
  layout: string;
  nome: string;
  tipo: string;
  tamanhos_linha: number[];
  regras: DslRule[];
}

export function writeSpecs(
  specsDir: string,
  rulesByLayout: Record<string, DslRule[]>
): void {
  mkdirSync(`${specsDir}/layouts`, { recursive: true });

  const index: IndexSpec = {
    fonte: "https://wspf.banco.bradesco/wsValidadorUniversal/validadorgeral",
    extraido_em: new Date().toISOString().split("T")[0],
    observacao:
      "Regras extraídas por AST dos arquivos JS públicos do validador Bradesco.",
    total_regras: Object.values(rulesByLayout).reduce(
      (sum, rules) => sum + rules.length,
      0
    ),
    layouts: Object.entries(rulesByLayout).map(([layout, rules]) => {
      const entry: LayoutEntry = {
        layout,
        nome: nomeLayout(layout),
        tipo: "remessa",
        tamanhos_linha: tamanhosLayout(layout),
        arquivo: `layouts/${layout}.json`,
        total_regras: rules.length,
        sub_layouts: subLayouts(layout, rules),
      };

      const layoutSpec: LayoutSpec = {
        layout,
        nome: entry.nome,
        tipo: entry.tipo,
        tamanhos_linha: entry.tamanhos_linha,
        regras: rules,
      };

      writeFileSync(
        `${specsDir}/layouts/${layout}.json`,
        JSON.stringify(layoutSpec, null, 2),
        "utf-8"
      );

      return entry;
    }),
  };

  writeFileSync(`${specsDir}/index.json`, JSON.stringify(index, null, 2), "utf-8");
}

function nomeLayout(layout: string): string {
  const nomes: Record<string, string> = {
    "cobranca-remessa": "Cobrança — Remessa",
    multipag: "Multipag",
    "folha-pagamento": "Folha de Pagamento",
  };
  return nomes[layout] ?? layout;
}

function tamanhosLayout(layout: string): number[] {
  const tamanhos: Record<string, number[]> = {
    "cobranca-remessa": [240, 400],
    multipag: [240],
    "folha-pagamento": [200, 240],
  };
  return tamanhos[layout] ?? [];
}

function subLayouts(layout: string, rules: DslRule[]): { funcao: string; regras: number }[] {
  const grupos = new Map<string, number>();
  for (const r of rules) {
    grupos.set(r.funcao_origem, (grupos.get(r.funcao_origem) ?? 0) + 1);
  }
  return Array.from(grupos.entries()).map(([funcao, count]) => ({
    funcao,
    regras: count,
  }));
}
```

- [ ] **Step 4: Rodar testes para confirmar que passam**

Run: `cd tools/spec-extractor && bun test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/spec-extractor/src/spec-generator.ts tools/spec-extractor/tests/spec-generator.test.ts
git commit -m "feat: gerador de specs JSON"
```

---

### Task 7: CLI do extrator e orquestração

**Files:**
- Create: `tools/spec-extractor/src/index.ts`
- Create: `tools/spec-extractor/README.md`

- [ ] **Step 1: Implementar `src/index.ts`**

```typescript
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ASSETS_DIR,
  LAYOUTS_DO_CICLO,
  MAPEAMENTO_FUNCOES,
  SPECS_DIR,
  VALIDADOR_URL,
} from "./config.js";
import {
  downloadText,
  extractInlineScripts,
  extractScriptUrls,
  saveAsset,
} from "./downloader.js";
import { extractNamedFunctions } from "./inline-parser.js";
import { extractRulesFromFunction } from "./ast-walker.js";
import { mapToDsl } from "./rule-mapper.js";
import { writeSpecs } from "./spec-generator.js";

async function main() {
  mkdirSync(ASSETS_DIR, { recursive: true });

  console.log(`Baixando ${VALIDADOR_URL}...`);
  const html = await downloadText(VALIDADOR_URL);
  const htmlPath = `${ASSETS_DIR}/validadorgeral.html`;
  writeFileSync(htmlPath, html, "utf-8");

  const scriptUrls = extractScriptUrls(html, VALIDADOR_URL);
  console.log(`Encontrados ${scriptUrls.length} scripts externos.`);

  const sources = new Map<string, string>();
  for (const url of scriptUrls) {
    const content = await downloadText(url);
    const path = await saveAsset(url, content, ASSETS_DIR);
    sources.set(url, content);
    console.log(`Salvo: ${path}`);
  }

  const inlineScripts = extractInlineScripts(html);
  const inlineFunctions = new Map<string, string>();
  for (const script of inlineScripts) {
    for (const [name, body] of extractNamedFunctions(script)) {
      inlineFunctions.set(name, body);
    }
  }

  const rulesByLayout: Record<string, ReturnType<typeof mapToDsl>[]> = {};

  for (const [funcName, layout] of Object.entries(MAPEAMENTO_FUNCOES)) {
    if (!LAYOUTS_DO_CICLO.includes(layout as any)) continue;

    let source = "";
    for (const content of sources.values()) {
      if (content.includes(`function ${funcName}`) || content.includes(`${funcName} =`)) {
        source = content;
        break;
      }
    }
    if (!source && inlineFunctions.has(funcName)) {
      source = inlineFunctions.get(funcName)!;
    }
    if (!source) {
      console.warn(`Função não encontrada: ${funcName}`);
      continue;
    }

    const rawRules = extractRulesFromFunction(source, funcName);
    const dslRules = rawRules.map((r) => mapToDsl(r, layout));
    rulesByLayout[layout] = rulesByLayout[layout] ?? [];
    rulesByLayout[layout].push(...dslRules);
    console.log(`${funcName}: ${dslRules.length} regras -> ${layout}`);
  }

  writeSpecs(SPECS_DIR, rulesByLayout);
  console.log(`Specs escritos em ${SPECS_DIR}`);

  await writeBaseline([html, ...sources.values()]);
}

async function writeBaseline(contents: string[]) {
  const hash = createHash("sha256");
  for (const c of contents) hash.update(c);
  const baseline = {
    data: new Date().toISOString(),
    sha256: hash.digest("hex"),
    fontes: [VALIDADOR_URL],
  };
  writeFileSync(`${ASSETS_DIR}/baseline.json`, JSON.stringify(baseline, null, 2));
  console.log(`Baseline SHA-256: ${baseline.sha256}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Criar README mínimo**

Create `tools/spec-extractor/README.md`:

```markdown
# Bradesco Spec Extractor

Extrai regras de validação dos assets públicos do validador Bradesco via AST.

## Uso

```bash
bun install
bun run dev
```

Saída em `../../specs/`.
```

- [ ] **Step 3: Commit**

```bash
git add tools/spec-extractor/src/index.ts tools/spec-extractor/README.md
git commit -m "feat: CLI do extrator de regras"
```

---

### Task 8: Teste de integração end-to-end

**Files:**
- Create: `tools/spec-extractor/tests/extractor.e2e.test.ts`

- [ ] **Step 1: Criar teste e2e com assets mockados**

Create `tools/spec-extractor/tests/extractor.e2e.test.ts`:

```typescript
import { describe, it, mock } from "bun:test";
import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadText, extractScriptUrls } from "../src/downloader.js";
import { extractRulesFromFunction } from "../src/ast-walker.js";
import { mapToDsl } from "../src/rule-mapper.js";
import { writeSpecs } from "../src/spec-generator.js";

describe("extrator end-to-end", () => {
  it("gera specs a partir de assets mockados", async () => {
    const specsDir = mkdtempSync(join(tmpdir(), "extractor-e2e-"));

    const html = `
      <html>
        <script src="/js/remessa.js"></script>
        <script>function util() {}</script>
      </html>
    `;
    const js = `
      function validarDadosArquivo240(res) {
        var str = "";
        if (res[0].substring(3, 7) != "0000") {
          str += "Linha 1, colunas 004 a 007, Header de arquivo, não contém número de lote 0000.<br>";
        }
        return str;
      }
    `;

    global.fetch = mock.fn(async (url: string) => {
      const body = url.includes("remessa.js") ? js : html;
      return { ok: true, text: async () => body } as Response;
    });

    const downloadedHtml = await downloadText("http://mock/validador");
    const urls = extractScriptUrls(downloadedHtml, "http://mock/validador");
    const source = await downloadText(urls[0]);
    const raw = extractRulesFromFunction(source, "validarDadosArquivo240");
    const dsl = raw.map((r) => mapToDsl(r, "cobranca-remessa"));
    writeSpecs(specsDir, { "cobranca-remessa": dsl });

    const index = JSON.parse(readFileSync(join(specsDir, "index.json"), "utf-8"));
    assert.strictEqual(index.total_regras, 1);

    rmSync(specsDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Refinar CLI para aceitar flags `--assets-dir` e `--specs-dir`**

Modify `src/index.ts` to accept CLI args via `process.argv`:

```typescript
const args = process.argv.slice(2);
const assetsDir = extractFlag(args, "--assets-dir") ?? ASSETS_DIR;
const specsDir = extractFlag(args, "--specs-dir") ?? SPECS_DIR;

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}
```

- [ ] **Step 3: Commit**

```bash
git add tools/spec-extractor/tests/extractor.e2e.test.ts tools/spec-extractor/src/index.ts
git commit -m "test: esqueleto de teste e2e e flags de diretorio"
```

---

## Self-Review

**1. Spec coverage:**
- Download de assets HTML/JS: Task 2.
- Extração de scripts inline: Task 3.
- AST walker para regras: Task 4.
- Mapeamento para DSL: Task 5.
- Geração de specs JSON: Task 6.
- CLI e orquestração: Task 7.
- Testes: Tasks 2-8.
- Monitor de mudança (hash baseline): Task 7.
- Formato `funcao_origem`: Task 5.

**2. Placeholder scan:** Nenhum TBD/TODO. Os arquétipos `modulo_11` e `coerencia_registro` têm esqueletos realistas; refinamentos virão ao rodar contra o JS real.

**3. Type consistency:** `RawRule`, `DslRule`, `DslCondition` e `writeSpecs` usam os mesmos nomes de campos (`funcao_origem`, `linha_fonte`, `colunas`, `posicoes`) ao longo do plano.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-18-fase-0-extrator-de-regras.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
