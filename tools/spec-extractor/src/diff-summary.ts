import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface DslCondition {
  tipo: string;
}

interface DslRule {
  id: string;
  funcao_origem: string;
  registro: string;
  condicao: DslCondition;
}

interface LayoutSpec {
  layout: string;
  regras: DslRule[];
}

interface IndexSpec {
  layouts: {
    layout: string;
    arquivo: string;
    total_regras: number;
  }[];
}

interface Change {
  id: string;
  kind: "added" | "removed" | "changed";
  funcao_origem: string;
  registro: string;
  archetype: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/**
 * Índice de um lado do diff. A base pode não ter specs — é o caso de um PR contra
 * um branch onde `tools/specs/` ainda não existe. Aí todo o spec do PR é novidade,
 * que é exatamente o que o resumo deve dizer, em vez de quebrar.
 */
function readIndexOrEmpty(dir: string): IndexSpec {
  const path = join(dir, "index.json");
  if (!existsSync(path)) {
    return { layouts: [] };
  }
  return readJson<IndexSpec>(path);
}

function indexById(rules: DslRule[]): Map<string, DslRule> {
  const map = new Map<string, DslRule>();
  for (const r of rules) {
    map.set(r.id, r);
  }
  return map;
}

function detectChanges(oldRules: DslRule[], newRules: DslRule[]): Change[] {
  const oldMap = indexById(oldRules);
  const newMap = indexById(newRules);
  const changes: Change[] = [];

  for (const [id, rule] of newMap) {
    if (!oldMap.has(id)) {
      changes.push({
        id,
        kind: "added",
        funcao_origem: rule.funcao_origem,
        registro: rule.registro,
        archetype: rule.condicao.tipo,
      });
    } else {
      const old = oldMap.get(id)!;
      if (
        old.funcao_origem !== rule.funcao_origem ||
        old.registro !== rule.registro ||
        old.condicao.tipo !== rule.condicao.tipo
      ) {
        changes.push({
          id,
          kind: "changed",
          funcao_origem: rule.funcao_origem,
          registro: rule.registro,
          archetype: rule.condicao.tipo,
        });
      }
    }
  }

  for (const [id, rule] of oldMap) {
    if (!newMap.has(id)) {
      changes.push({
        id,
        kind: "removed",
        funcao_origem: rule.funcao_origem,
        registro: rule.registro,
        archetype: rule.condicao.tipo,
      });
    }
  }

  return changes;
}

function aggregateByLayout(changes: Change[]): Map<string, Change[]> {
  const groups = new Map<string, Change[]>();
  for (const c of changes) {
    const layout = c.id.split(":")[0] ?? "desconhecido";
    const list = groups.get(layout) ?? [];
    list.push(c);
    groups.set(layout, list);
  }
  return groups;
}

function aggregateByRegistro(changes: Change[]): Map<string, Change[]> {
  const groups = new Map<string, Change[]>();
  for (const c of changes) {
    const list = groups.get(c.registro) ?? [];
    list.push(c);
    groups.set(c.registro, list);
  }
  return groups;
}

function aggregateByArchetype(changes: Change[]): Map<string, Change[]> {
  const groups = new Map<string, Change[]>();
  for (const c of changes) {
    const list = groups.get(c.archetype) ?? [];
    list.push(c);
    groups.set(c.archetype, list);
  }
  return groups;
}

function printGroup(title: string, groups: Map<string, Change[]>): void {
  console.log(`\n## ${title}`);
  if (groups.size === 0) {
    console.log("_Nenhuma alteração._");
    return;
  }
  for (const [key, list] of Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const added = list.filter((c) => c.kind === "added").length;
    const removed = list.filter((c) => c.kind === "removed").length;
    const changed = list.filter((c) => c.kind === "changed").length;
    console.log(`- ${key}: +${added} / -${removed} / ~${changed}`);
  }
}

export function diffSummary(oldDir: string, newDir: string): {
  hasChanges: boolean;
  totalChanges: number;
} {
  const oldIndex = readIndexOrEmpty(oldDir);
  const newIndex = readIndexOrEmpty(newDir);

  const oldLayouts = new Map(oldIndex.layouts.map((l) => [l.layout, l]));
  const newLayouts = new Map(newIndex.layouts.map((l) => [l.layout, l]));

  const allChanges: Change[] = [];

  for (const layout of new Set([...oldLayouts.keys(), ...newLayouts.keys()])) {
    const oldSpec = oldLayouts.has(layout)
      ? readJson<LayoutSpec>(join(oldDir, oldLayouts.get(layout)!.arquivo))
      : { layout, regras: [] };
    const newSpec = newLayouts.has(layout)
      ? readJson<LayoutSpec>(join(newDir, newLayouts.get(layout)!.arquivo))
      : { layout, regras: [] };

    const changes = detectChanges(oldSpec.regras, newSpec.regras);
    allChanges.push(...changes);
  }

  if (allChanges.length === 0) {
    console.log("Nenhuma diferença entre os specs.");
    return { hasChanges: false, totalChanges: 0 };
  }

  const byLayout = aggregateByLayout(allChanges);

  console.log(`# Resumo do diff de specs`);
  console.log(`Total de alterações: ${allChanges.length}`);

  console.log("\n## Por layout");
  for (const [layout, list] of Array.from(byLayout.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const added = list.filter((c) => c.kind === "added").length;
    const removed = list.filter((c) => c.kind === "removed").length;
    const changed = list.filter((c) => c.kind === "changed").length;
    console.log(`- ${layout}: +${added} / -${removed} / ~${changed}`);
  }

  for (const [layout, list] of byLayout) {
    console.log(`\n### ${layout}`);
    printGroup("Por tipo de registro", aggregateByRegistro(list));
    printGroup("Por arquétipo de condição", aggregateByArchetype(list));
  }

  return { hasChanges: true, totalChanges: allChanges.length };
}

if (import.meta.main) {
  const [oldDir, newDir] = process.argv.slice(2);
  if (!oldDir || !newDir) {
    console.error("Uso: bun run src/diff-summary.ts <specs-antigo> <specs-novo>");
    process.exit(1);
  }

  const { hasChanges, totalChanges } = diffSummary(oldDir, newDir);
  if (hasChanges) {
    process.exit(0);
  }
}
