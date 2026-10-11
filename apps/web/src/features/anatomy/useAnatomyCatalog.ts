import { useEffect, useMemo, useState } from "react";
import localTreeJson from "./anatomyTree.local.json";
import { searchLocalTree } from "./treeModel";
import type { LocalTreeFixture, SearchHit } from "./types";

const LOCAL_TREE = localTreeJson as LocalTreeFixture;

export type CatalogSource = "api" | "local-atlas-fixture";

interface TreePayload {
  nodes?: unknown;
  systems?: unknown;
  root_id?: unknown;
}

function asTree(data: TreePayload): LocalTreeFixture | null {
  if (!Array.isArray(data.nodes) || typeof data.root_id !== "string") return null;
  return {
    nodes: data.nodes as LocalTreeFixture["nodes"],
    systems: Array.isArray(data.systems) ? (data.systems as LocalTreeFixture["systems"]) : [],
    root_id: data.root_id,
    fixture_label: "local atlas fixture",
    source_status: [],
  };
}

async function loadTree(signal: AbortSignal): Promise<{ tree: LocalTreeFixture; source: CatalogSource }> {
  const local = LOCAL_TREE;
  try {
    const res = await fetch("/api/anatomy/tree", { signal });
    if (res.status === 404 || res.status === 405 || res.status === 501) return { tree: local, source: "local-atlas-fixture" };
    if (!res.ok) return { tree: local, source: "local-atlas-fixture" };
    const parsed = asTree((await res.json()) as TreePayload);
    return parsed ? { tree: parsed, source: "api" } : { tree: local, source: "local-atlas-fixture" };
  } catch {
    return { tree: local, source: "local-atlas-fixture" };
  }
}

async function loadSearch(query: string, signal: AbortSignal, local: LocalTreeFixture): Promise<{ hits: SearchHit[]; source: CatalogSource }> {
  const fallback = searchLocalTree(local, query);
  try {
    const res = await fetch(`/api/anatomy/search?q=${encodeURIComponent(query)}&limit=20`, { signal });
    if (res.status === 404 || res.status === 405 || res.status === 501) return { hits: fallback, source: "local-atlas-fixture" };
    if (!res.ok) return { hits: fallback, source: "local-atlas-fixture" };
    const data = (await res.json()) as { results?: SearchHit[] };
    if (!Array.isArray(data.results)) return { hits: fallback, source: "local-atlas-fixture" };
    return { hits: data.results, source: "api" };
  } catch {
    return { hits: fallback, source: "local-atlas-fixture" };
  }
}

export function useAnatomyTree() {
  const [tree, setTree] = useState<LocalTreeFixture>(() => LOCAL_TREE);
  const [source, setSource] = useState<CatalogSource>("local-atlas-fixture");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    loadTree(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setTree(r.tree);
      setSource(r.source);
      setReady(true);
    });
    return () => ctrl.abort();
  }, []);

  return { tree, source, ready };
}

export function useAnatomySearch(query: string, tree: LocalTreeFixture) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [fetchedQuery, setFetchedQuery] = useState<string | null>(null);
  const [source, setSource] = useState<CatalogSource>("local-atlas-fixture");
  const q = query.trim();
  const localHits = useMemo(() => searchLocalTree(tree, q), [tree, q]);

  useEffect(() => {
    if (!q) {
      setHits([]);
      setFetchedQuery(null);
      return;
    }
    const ctrl = new AbortController();
    loadSearch(q, ctrl.signal, tree).then((r) => {
      if (ctrl.signal.aborted) return;
      setHits(r.hits);
      setFetchedQuery(q);
      setSource(r.source);
    });
    return () => ctrl.abort();
  }, [q, tree]);

  const effectiveHits = fetchedQuery === q ? hits : (localHits.length > 0 ? localHits : hits);
  return { hits: q ? effectiveHits : [], source: q ? source : "local-atlas-fixture", localHits };
}

export const LOCAL_FIXTURE_LABEL = "local atlas fixture";
