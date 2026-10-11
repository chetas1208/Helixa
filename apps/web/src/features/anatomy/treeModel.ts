import type { CatalogNode, LocalTreeFixture, SearchHit } from "./types";

export function childrenOf(nodes: CatalogNode[], parentId: string): CatalogNode[] {
  return nodes.filter((n) => n.parent_ids.includes(parentId));
}

export function indexById(nodes: CatalogNode[]): Map<string, CatalogNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

/** Returns [] if acyclic; otherwise the first cycle of ids. */
export function findCycle(nodes: CatalogNode[]): string[] {
  const byId = indexById(nodes);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (!byId.has(n.id)) continue;
    for (const p of n.parent_ids) {
      const list = kids.get(p) ?? [];
      list.push(n.id);
      kids.set(p, list);
    }
  }

  const visit = (id: string): string[] | null => {
    if (done.has(id)) return null;
    if (visiting.has(id)) {
      const i = stack.indexOf(id);
      return stack.slice(Math.max(0, i)).concat(id);
    }
    visiting.add(id);
    stack.push(id);
    for (const c of kids.get(id) ?? []) {
      const hit = visit(c);
      if (hit) return hit;
    }
    visiting.delete(id);
    done.add(id);
    stack.pop();
    return null;
  };

  for (const n of nodes) {
    const hit = visit(n.id);
    if (hit) return hit;
  }
  return [];
}

export function isAcyclic(nodes: CatalogNode[]): boolean {
  return findCycle(nodes).length === 0;
}

function scoreMatch(q: string, label: string, synonyms: string[], id: string): { score: number; matched: string } | null {
  const nq = q.trim().toLowerCase();
  if (!nq) return null;
  const fields = [label, ...synonyms, id];
  let best: { score: number; matched: string } | null = null;
  for (const f of fields) {
    const s = f.toLowerCase();
    if (s === nq) return { score: 1, matched: f };
    if (s.startsWith(nq)) {
      const sc = 0.85;
      if (!best || sc > best.score) best = { score: sc, matched: f };
    } else if (s.includes(nq)) {
      const sc = 0.6;
      if (!best || sc > best.score) best = { score: sc, matched: f };
    }
  }
  return best;
}

export function searchLocalTree(tree: LocalTreeFixture, query: string, limit = 20): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const n of tree.nodes) {
    const m = scoreMatch(q, n.label, n.synonyms, n.id);
    if (m) hits.push({ result_type: "anatomy", id: n.id, label: n.label, matched: m.matched, score: m.score, laterality: n.laterality });
  }
  for (const s of tree.systems) {
    const m = scoreMatch(q, s.label, [s.id], s.id);
    if (m) hits.push({ result_type: "system", id: s.id, label: s.label, matched: m.matched, score: m.score, laterality: null });
  }
  hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return hits.slice(0, limit);
}

export function breadcrumb(nodes: CatalogNode[], id: string): { id: string; label: string }[] {
  const byId = indexById(nodes);
  const out: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  let cur: CatalogNode | undefined = byId.get(id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push({ id: cur.id, label: cur.label });
    cur = cur.parent_ids[0] ? byId.get(cur.parent_ids[0]) : undefined;
  }
  return out.reverse();
}

export function unavailableNodes(nodes: CatalogNode[]): CatalogNode[] {
  return nodes.filter((n) => n.mesh_status === "unavailable");
}
