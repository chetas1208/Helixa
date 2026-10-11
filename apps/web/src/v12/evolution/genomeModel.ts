/**
 * Pure model for the Genome version track. Everything is derived from the workspace's real `revisions`
 * (cumulative edit lists vs the reference). Nothing is invented: no ancestors beyond the stored parent chain.
 */
import type { Edit, Revision } from "../types";

export interface BaseChange {
  position: number; // 1-based
  from: string; // allele in the earlier state
  to: string; // allele in the later state
}

/** Final allele per position after applying edits in order (later edits win). */
export function effectiveAlleles(edits: readonly Edit[]): Map<number, { ref: string; alt: string }> {
  const m = new Map<number, { ref: string; alt: string }>();
  for (const e of edits) {
    const prev = m.get(e.position);
    m.set(e.position, { ref: prev ? prev.ref : e.ref, alt: e.alt });
  }
  return m;
}

/** Positions whose allele differs between two states, expressed as from -> to. Reverts to reference drop out. */
export function diffEdits(a: readonly Edit[], b: readonly Edit[]): BaseChange[] {
  const ea = effectiveAlleles(a);
  const eb = effectiveAlleles(b);
  const out: BaseChange[] = [];
  const positions = new Set([...ea.keys(), ...eb.keys()]);
  for (const position of [...positions].sort((x, y) => x - y)) {
    const A = ea.get(position);
    const B = eb.get(position);
    const ref = (A ?? B)!.ref;
    const from = A ? A.alt : ref;
    const to = B ? B.alt : ref;
    if (from !== to) out.push({ position, from, to });
  }
  return out;
}

export interface WindowDiffCell {
  position: number;
  ref: string;
  edited: string;
  changed: boolean;
}

/** Windowed reference-vs-edited bases. `windowStart` is the 1-based coordinate of bases[0]. */
export function windowDiff(refBases: string, windowStart: number, baseline: readonly Edit[], target: readonly Edit[]): { cells: WindowDiffCell[]; outside: BaseChange[] } {
  const changes = diffEdits(baseline, target);
  const byPos = new Map(changes.map((c) => [c.position, c]));
  const cells: WindowDiffCell[] = [...refBases].map((ref, i) => {
    const position = windowStart + i;
    const c = byPos.get(position);
    return { position, ref, edited: c ? c.to : ref, changed: !!c };
  });
  const end = windowStart + refBases.length - 1;
  return { cells, outside: changes.filter((c) => c.position < windowStart || c.position > end) };
}

/** Applies target edits to a reference window, returning the edited string (for cross-checking recorded previews). */
export function applyToWindow(refBases: string, windowStart: number, edits: readonly Edit[]): string {
  const chars = [...refBases];
  for (const [pos, v] of effectiveAlleles(edits)) {
    const i = pos - windowStart;
    if (i >= 0 && i < chars.length) chars[i] = v.alt;
  }
  return chars.join("");
}

/** A genome revision as the UI knows it. Fields the API did not provide are null, never guessed. */
export interface RevNode {
  id: string;
  parentId: string | null;
  editCount: number;
  sha256: string | null;
  createdAt: string | null;
  harnessVersionId: string | null;
  previewBases: string | null;
  /** Cumulative edit list vs the reference, or null when the API did not provide positions for this revision. */
  edits: Edit[] | null;
  editsSource: "recorded" | "derived" | "unknown";
  /** True for the unedited reference anchor that is not a stored revision. */
  virtual?: boolean;
  /** Parent id recorded by the API when it points outside this workspace (a branch). Informational only. */
  branchedFromId?: string | null;
  /** Workspace that stores this revision (set when built from several workspaces' lineages). */
  workspaceId?: string;
  workspaceName?: string;
}

export const REFERENCE_ANCHOR_ID = "__reference__";

export function nodesFromRevisions(revisions: readonly Revision[]): RevNode[] {
  return revisions.map((r) => ({
    id: r.genome_revision_id,
    parentId: r.parent_revision_id,
    editCount: r.edits.length,
    sha256: r.sequence_sha256,
    createdAt: r.created_at,
    harnessVersionId: r.harness_version_id,
    previewBases: r.preview_1_48,
    edits: r.edits,
    editsSource: "recorded" as const,
  }));
}

export interface LineageRevision {
  genome_revision_id: string;
  parent_revision_id: string | null;
  edit_count: number;
  sequence_sha256: string;
}

/**
 * Nodes from GET .../genome-lineage (ids, parents, edit counts, hashes) plus the full active revision.
 * Commits append exactly one edit to the parent's list, so for ANCESTORS of the active revision the edit list is
 * the first `edit_count` entries of the active one: positions are derived from real data and flagged "derived".
 * Revisions off the active line get no positions (editsSource "unknown").
 */
export function nodesFromLineage(lineage: readonly LineageRevision[], active: Revision): RevNode[] {
  const byId = new Map(lineage.map((n) => [n.genome_revision_id, n]));
  const ancestors = new Set<string>();
  for (let cur = byId.get(active.genome_revision_id); cur && !ancestors.has(cur.genome_revision_id); cur = cur.parent_revision_id ? byId.get(cur.parent_revision_id) : undefined) {
    ancestors.add(cur.genome_revision_id);
  }
  return lineage.map((n) => {
    const isActive = n.genome_revision_id === active.genome_revision_id;
    const derivable = !isActive && ancestors.has(n.genome_revision_id) && n.edit_count <= active.edits.length;
    const zero = n.edit_count === 0;
    return {
      id: n.genome_revision_id,
      parentId: n.parent_revision_id,
      editCount: n.edit_count,
      sha256: n.sequence_sha256,
      createdAt: isActive ? active.created_at : null,
      harnessVersionId: isActive ? active.harness_version_id : null,
      previewBases: isActive ? active.preview_1_48 : null,
      edits: isActive ? active.edits : zero ? [] : derivable ? active.edits.slice(0, n.edit_count) : null,
      editsSource: isActive || zero ? ("recorded" as const) : derivable ? ("derived" as const) : ("unknown" as const),
    };
  });
}

export interface WorkspaceLineage {
  workspaceId: string;
  name: string;
  nodes: readonly LineageRevision[];
  active: Revision | null;
}

/**
 * Joins the lineages of several workspaces wherever a recorded `parent_revision_id` points into another
 * workspace's lineage (that is how `branch` records a fork). Only workspaces connected to `currentWs` by real ids
 * are kept. Edit positions are derived per workspace exactly as in `nodesFromLineage` (each workspace's active
 * revision carries the cumulative edit list of its whole ancestor chain).
 */
export function nodesFromWorkspaces(currentWs: string, all: readonly WorkspaceLineage[]): RevNode[] {
  const cur = all.find((w) => w.workspaceId === currentWs);
  if (!cur) return [];
  const owner = new Map<string, WorkspaceLineage>();
  const byId = new Map<string, LineageRevision>();
  const add = (w: WorkspaceLineage) => w.nodes.forEach((n) => !byId.has(n.genome_revision_id) && (byId.set(n.genome_revision_id, n), owner.set(n.genome_revision_id, w)));
  add(cur);
  const included = new Set([cur.workspaceId]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const w of all) {
      if (included.has(w.workspaceId)) continue;
      const touches = w.nodes.some((n) => (n.parent_revision_id && byId.has(n.parent_revision_id)) || [...byId.values()].some((m) => m.parent_revision_id === n.genome_revision_id));
      if (touches) {
        included.add(w.workspaceId);
        add(w);
        changed = true;
      }
    }
  }
  const edits = new Map<string, { edits: Edit[]; source: "recorded" | "derived" }>();
  const derive = (w: WorkspaceLineage) => {
    const a = w.active;
    if (!a || !byId.has(a.genome_revision_id)) return;
    const seen = new Set<string>();
    for (let n = byId.get(a.genome_revision_id); n && !seen.has(n.genome_revision_id); n = n.parent_revision_id ? byId.get(n.parent_revision_id) : undefined) {
      seen.add(n.genome_revision_id);
      if (edits.has(n.genome_revision_id)) continue;
      const isActive = n.genome_revision_id === a.genome_revision_id;
      if (isActive) edits.set(n.genome_revision_id, { edits: a.edits, source: "recorded" });
      else if (n.edit_count <= a.edits.length) edits.set(n.genome_revision_id, { edits: a.edits.slice(0, n.edit_count), source: "derived" });
    }
  };
  derive(cur);
  for (const w of all) if (w !== cur && included.has(w.workspaceId)) derive(w);
  return [...byId.values()].map((n) => {
    const w = owner.get(n.genome_revision_id)!;
    const isActive = w.active?.genome_revision_id === n.genome_revision_id;
    const e = n.edit_count === 0 ? { edits: [] as Edit[], source: "recorded" as const } : edits.get(n.genome_revision_id);
    return {
      id: n.genome_revision_id,
      parentId: n.parent_revision_id,
      editCount: n.edit_count,
      sha256: n.sequence_sha256,
      createdAt: isActive ? w.active!.created_at : null,
      harnessVersionId: isActive ? w.active!.harness_version_id : null,
      previewBases: isActive ? w.active!.preview_1_48 : null,
      edits: e ? e.edits : null,
      editsSource: e ? e.source : ("unknown" as const),
      workspaceId: w.workspaceId,
      workspaceName: w.name,
    };
  });
}

export interface GenomeEvent {
  id: string;
  node: RevNode;
  parentId: string | null;
  isBaseline: boolean;
  isCurrent: boolean;
  /** First revision of a workspace whose parent lives in another workspace (recorded fork). */
  isBranchPoint: boolean;
  /** Changes introduced relative to the parent. Empty when `deltaKnown` is false. */
  delta: BaseChange[];
  /** False when the API did not provide base positions for this revision or its parent. */
  deltaKnown: boolean;
  /** Edits added vs the parent, from edit counts (always available except for the anchor). */
  addedCount: number | null;
  /** Cumulative changes relative to the reference baseline. Empty when `diffKnown` is false. */
  fromBaseline: BaseChange[];
  diffKnown: boolean;
  branchId: string;
}

export interface GenomeBranch {
  id: string;
  label: string;
  headId: string;
  /** Revision ids from the baseline to the head, in order. */
  path: string[];
  containsCurrent: boolean;
}

export interface GenomeTimeline {
  events: Map<string, GenomeEvent>;
  baselineId: string | null;
  branches: GenomeBranch[];
  /** True when the workspace has no saved edits beyond the baseline. */
  baselineOnly: boolean;
  /** Set when the first stored revision already carries edits (a branched workspace): the reference anchor is not a stored revision. */
  virtualBaseline: boolean;
}

export function buildGenomeTimeline(input: readonly (RevNode | Revision)[], currentId: string): GenomeTimeline {
  let nodes: RevNode[] = input.map((x) => ("genome_revision_id" in x ? nodesFromRevisions([x])[0] : x));
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => !n.parentId || !ids.has(n.parentId));
  let baseline = roots.find((n) => n.editCount === 0) ?? null;
  let virtualBaseline = false;
  if (!baseline && roots.length) {
    virtualBaseline = true;
    baseline = { id: REFERENCE_ANCHOR_ID, parentId: null, editCount: 0, sha256: null, createdAt: null, harnessVersionId: null, previewBases: null, edits: [], editsSource: "recorded", virtual: true };
    nodes = [baseline, ...nodes.map((n) => (roots[0].id === n.id ? { ...n, branchedFromId: n.parentId, parentId: REFERENCE_ANCHOR_ID } : n))];
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId && byId.has(n.parentId)) childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]);
  const heads = nodes.filter((n) => !(childrenOf.get(n.id)?.length)).map((n) => n.id);
  const pathTo = (id: string): string[] => {
    const p: string[] = [];
    const guard = new Set<string>();
    for (let cur = byId.get(id); cur && !guard.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      guard.add(cur.id);
      p.unshift(cur.id);
    }
    return p;
  };
  const branches: GenomeBranch[] = heads.map((h, i) => {
    const path = pathTo(h);
    const name = byId.get(h)?.workspaceName;
    return { id: `branch-${h}`, label: heads.length === 1 ? "Main line (only branch)" : name ? `${name} (head ${h})` : `Branch ${i + 1} to ${h}`, headId: h, path, containsCurrent: path.includes(currentId) };
  });
  branches.sort((a, b) => Number(b.containsCurrent) - Number(a.containsCurrent));
  const branchOf = new Map<string, string>();
  for (const b of [...branches].reverse()) for (const id of b.path) branchOf.set(id, b.id);
  for (const b of branches) if (b.containsCurrent) for (const id of b.path) branchOf.set(id, b.id);

  const events = new Map<string, GenomeEvent>();
  for (const n of nodes) {
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    events.set(n.id, {
      id: n.id,
      node: n,
      parentId: parent ? parent.id : null,
      isBaseline: baseline ? n.id === baseline.id : false,
      isCurrent: n.id === currentId,
      isBranchPoint: !!(parent && n.workspaceId && parent.workspaceId && parent.workspaceId !== n.workspaceId),
      delta: parent && parent.edits && n.edits ? diffEdits(parent.edits, n.edits) : [],
      deltaKnown: !!(parent ? parent.edits && n.edits : n.edits),
      addedCount: parent ? Math.max(0, n.editCount - parent.editCount) : null,
      fromBaseline: baseline && baseline.edits && n.edits ? diffEdits(baseline.edits, n.edits) : [],
      diffKnown: !!(baseline && baseline.edits && n.edits),
      branchId: branchOf.get(n.id) ?? "",
    });
  }
  const real = nodes.filter((n) => !n.virtual);
  return { events, baselineId: baseline?.id ?? null, branches, baselineOnly: real.length <= 1 && (real[0]?.editCount ?? 0) === 0, virtualBaseline };
}

/** One-line label for a stepper node. */
export function eventLabel(e: GenomeEvent): string {
  if (e.isBaseline) return e.node.virtual ? "Reference baseline" : "Baseline";
  if (e.isBranchPoint && e.deltaKnown && e.delta.length === 0) return "Branched (copy)";
  if (e.deltaKnown && e.delta.length === 1) return `Base ${e.delta[0].position}: ${e.delta[0].from} to ${e.delta[0].to}`;
  if (e.deltaKnown && e.delta.length > 1) return `${e.delta.length} bases changed`;
  if (e.deltaKnown && e.delta.length === 0) return "Saved version (no base change)";
  if (e.addedCount !== null && e.addedCount > 0) return `+${e.addedCount} edit${e.addedCount > 1 ? "s" : ""} (${e.node.editCount} total)`;
  return `Saved version (${e.node.editCount} edits)`;
}

/** Plain-language explanation of a baseline-to-target diff. Facts only; no biology is claimed. */
export function explainDiff(changes: readonly BaseChange[]): string {
  if (changes.length === 0) return "This sequence is identical to the baseline at every position.";
  const list = changes.slice(0, 6).map((c) => `position ${c.position} (${c.from} to ${c.to})`).join(", ");
  const more = changes.length > 6 ? `, and ${changes.length - 6} more` : "";
  return `${changes.length} single-base substitution${changes.length > 1 ? "s" : ""} against the baseline: ${list}${more}. This describes the stored sequence only; it is an in-silico sequence change, not a lab-verified edit, and no effect on traits or health was computed.`;
}

/** Short one-line diff summary for compact UI ("2 substitutions: 5 G>T, 12 A>G"). */
export function shortDiff(changes: readonly BaseChange[]): string {
  if (changes.length === 0) return "identical to baseline";
  const list = changes.slice(0, 4).map((c) => `${c.position} ${c.from}\u2192${c.to}`).join(", ");
  return `${changes.length} substitution${changes.length > 1 ? "s" : ""}: ${list}${changes.length > 4 ? ` +${changes.length - 4}` : ""}`;
}

/** Plain headline computed from stored data only. */
export function headline(editCount: number, harnessChanged: boolean): string {
  const harness = harnessChanged ? "analysis harness changed" : "analysis harness unchanged";
  if (editCount === 0) return `Identical to baseline: no edits saved yet; ${harness}`;
  return `${editCount} in-silico edit${editCount > 1 ? "s" : ""} since baseline; ${harness}`;
}
