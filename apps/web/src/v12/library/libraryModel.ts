/**
 * Pure view-model helpers for the Harness Library (workspaces). No React, no DOM, no network.
 * Everything here derives from fields the API actually returned; nothing is invented.
 */
import type { Edit, EvidenceKind, Revision, Simulation, Workspace } from "../types";

// ---------- search / filter / sort ----------

export type LibrarySort = "updated" | "created" | "name" | "edits";
export type LibraryFilter = "all" | "edited" | "baseline-only";

export const SORT_LABELS: Record<LibrarySort, string> = {
  updated: "Recently updated",
  created: "Genome revision created",
  name: "Name (A to Z)",
  edits: "Most edits",
};
export const FILTER_LABELS: Record<LibraryFilter, string> = {
  all: "All workspaces",
  edited: "With in-silico edits",
  "baseline-only": "Baseline only (no edits)",
};

const ts = (iso: string | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Best available creation time. The list endpoint does not return `created_at`, so this falls back to the active revision's time. */
export function workspaceCreatedAt(ws: Workspace): string {
  return ws.created_at ?? ws.revisions?.[0]?.created_at ?? ws.active_revision.created_at;
}

export const isArchived = (w: Pick<Workspace, "status">): boolean => w.status.toUpperCase() === "ARCHIVED";

export function filterAndSortWorkspaces(
  list: readonly Workspace[],
  opts: { query: string; filter: LibraryFilter; sort: LibrarySort; includeArchived?: boolean },
): Workspace[] {
  const q = opts.query.trim().toLowerCase();
  const out = list.filter((w) => {
    if (!opts.includeArchived && isArchived(w)) return false;
    if (opts.filter === "edited" && w.edit_count === 0) return false;
    if (opts.filter === "baseline-only" && w.edit_count !== 0) return false;
    if (!q) return true;
    return [w.name, w.workspace_id, w.active_genome_revision_id, w.reference_asset_id, w.assembly, w.active_harness_version_id].some((f) => f.toLowerCase().includes(q));
  });
  const cmp: Record<LibrarySort, (a: Workspace, b: Workspace) => number> = {
    updated: (a, b) => ts(b.updated_at) - ts(a.updated_at),
    created: (a, b) => ts(workspaceCreatedAt(b)) - ts(workspaceCreatedAt(a)),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.workspace_id.localeCompare(b.workspace_id),
    edits: (a, b) => b.edit_count - a.edit_count || ts(b.updated_at) - ts(a.updated_at),
  };
  // stable tiebreak on id so order never flickers between renders
  return [...out].sort((a, b) => cmp[opts.sort](a, b) || a.workspace_id.localeCompare(b.workspace_id));
}

// ---------- labelling ----------

/** 'local synthetic' is stated whenever the assembly is not the official GRCh38. */
export function assemblyLabel(ws: Pick<Workspace, "assembly" | "official_grch38">): string {
  return ws.official_grch38 ? ws.assembly : `${ws.assembly} (local synthetic, not GRCh38)`;
}

export function formatTimestamp(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "unknown";
  return new Date(t).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function shortId(id: string, keep = 14): string {
  return id.length > keep ? `${id.slice(0, keep)}…` : id;
}

// ---------- evidence status (one kind per claim) ----------

export interface WorkspaceEvidence {
  kind: EvidenceKind;
  label: string;
  detail: string;
}

/**
 * Evidence status of the workspace's genome state.
 *  - no edits: the sequence is the observed reference (REFERENCE)
 *  - edits whose allele at commit matched the recorded history: still an in-silico change, never lab-verified (HYPOTHESIS)
 *  - an edit whose commit-time allele disagrees with its ref: inconsistent record (INCONCLUSIVE)
 */
export interface EditCheck {
  edit: Edit;
  /** Allele that should have been present just before this edit: the previous alt at that position, else the reference allele. */
  expectedBefore: string;
  matched: boolean;
}

/** Replays edits in order and checks each recorded `current_allele_at_commit` against what the history implies. */
export function checkEdits(edits: readonly Edit[]): EditCheck[] {
  const last = new Map<number, string>();
  return edits.map((edit) => {
    const expectedBefore = last.get(edit.position) ?? edit.ref;
    last.set(edit.position, edit.alt);
    return { edit, expectedBefore, matched: edit.current_allele_at_commit === expectedBefore };
  });
}

export function workspaceEvidence(ws: Pick<Workspace, "edit_count" | "active_revision">): WorkspaceEvidence {
  const edits = ws.active_revision.edits;
  if (edits.length === 0 && ws.edit_count === 0) {
    return { kind: "REFERENCE", label: "Baseline reference", detail: "No edits: this genome state is the observed reference sequence." };
  }
  const mismatched = checkEdits(edits).filter((c) => !c.matched);
  if (mismatched.length > 0 || edits.length !== ws.edit_count) {
    return { kind: "INCONCLUSIVE", label: "Edit record inconsistent", detail: "An edit's allele at commit disagrees with the recorded history, or the edit list is incomplete." };
  }
  return {
    kind: "HYPOTHESIS",
    label: "In-silico edit",
    detail: `${edits.length} sequence change${edits.length === 1 ? "" : "s"} recorded; the allele found at each commit matched the recorded history. Not lab-verified and no biological effect is claimed.`,
  };
}

// ---------- branch path ----------

export interface BranchStep {
  revisionId: string;
  parentRevisionId: string | null;
  sequenceSha256: string;
  createdAt: string;
  editCount: number;
  /** Owning workspace when known (the active revision of a listed workspace, or this workspace's own history). */
  workspaceId: string | null;
  workspaceName: string | null;
}
export interface BranchPath {
  /** Newest first: the workspace's current revision, then parents. */
  steps: BranchStep[];
  /** True when the chain ends at a parent revision this client was never told about. */
  truncatedAt: string | null;
  /** Revision with no parent: the immutable baseline of this lineage. */
  root: BranchStep | null;
}

/** Walk parent links using every revision the API disclosed (full histories when present, otherwise active revisions). */
export function buildBranchPath(ws: Workspace, all: readonly Workspace[]): BranchPath {
  const index = new Map<string, { rev: Revision; ws: Workspace }>();
  const add = (rev: Revision, owner: Workspace) => {
    if (!index.has(rev.genome_revision_id)) index.set(rev.genome_revision_id, { rev, ws: owner });
  };
  // this workspace first, so its own history wins attribution
  for (const r of ws.revisions ?? []) add(r, ws);
  add(ws.active_revision, ws);
  for (const o of all) {
    for (const r of o.revisions ?? []) add(r, o);
    add(o.active_revision, o);
  }
  const steps: BranchStep[] = [];
  const seen = new Set<string>();
  let cursor: string | null = ws.active_revision.genome_revision_id;
  let truncatedAt: string | null = null;
  while (cursor) {
    if (seen.has(cursor)) break; // cycle guard
    seen.add(cursor);
    const hit = index.get(cursor);
    if (!hit) {
      truncatedAt = cursor;
      break;
    }
    steps.push({
      revisionId: hit.rev.genome_revision_id,
      parentRevisionId: hit.rev.parent_revision_id,
      sequenceSha256: hit.rev.sequence_sha256,
      createdAt: hit.rev.created_at,
      editCount: hit.rev.edits.length,
      workspaceId: hit.ws.workspace_id,
      workspaceName: hit.ws.name,
    });
    cursor = hit.rev.parent_revision_id;
  }
  const last = steps[steps.length - 1];
  return { steps, truncatedAt, root: last && last.parentRevisionId === null ? last : null };
}

export interface BaselineDescription {
  known: boolean;
  /** Plain-language sentence describing the immutable baseline revision of this workspace. */
  text: string;
  revisionId: string | null;
  sequenceSha256: string | null;
}

export function describeBaseline(path: BranchPath): BaselineDescription {
  if (path.root) {
    const own = path.steps.length === 1;
    return {
      known: true,
      revisionId: path.root.revisionId,
      sequenceSha256: path.root.sequenceSha256,
      text: own
        ? "This workspace is still at its baseline revision. The baseline is immutable: to continue from it, fork it with Branch."
        : `Baseline revision ${path.root.revisionId} is immutable. Every later revision is a new record that points back to it.`,
    };
  }
  return {
    known: false,
    revisionId: null,
    sequenceSha256: null,
    text: path.truncatedAt
      ? `The API reports only this workspace's current revision. Its ancestry continues at ${path.truncatedAt}, which was not returned, so the baseline revision cannot be shown here.`
      : "The baseline revision is not reported for this workspace.",
  };
}

// ---------- compare (read-only revision diff) ----------

export type CompareStatus = "same" | "differs" | "only-a" | "only-b";
export interface CompareRow {
  position: number;
  /** Allele in the reference at that position as recorded on the edit (ref). */
  ref: string;
  altA: string | null;
  altB: string | null;
  status: CompareStatus;
}
export interface WorkspaceComparison {
  sameReference: boolean;
  sameSequence: boolean;
  rows: CompareRow[];
  counts: Record<CompareStatus, number>;
}

/** Final allele per position (a later edit at a position overrides an earlier one). */
export function effectiveEdits(edits: readonly Edit[]): Map<number, Edit> {
  const m = new Map<number, Edit>();
  for (const e of edits) m.set(e.position, e);
  return m;
}

export function compareWorkspaces(a: Workspace, b: Workspace): WorkspaceComparison {
  const ea = effectiveEdits(a.active_revision.edits);
  const eb = effectiveEdits(b.active_revision.edits);
  const positions = [...new Set([...ea.keys(), ...eb.keys()])].sort((x, y) => x - y);
  const rows: CompareRow[] = positions.map((position) => {
    const x = ea.get(position);
    const y = eb.get(position);
    const status: CompareStatus = x && y ? (x.alt === y.alt ? "same" : "differs") : x ? "only-a" : "only-b";
    return { position, ref: (x ?? y)?.ref ?? "?", altA: x?.alt ?? null, altB: y?.alt ?? null, status };
  });
  const counts: Record<CompareStatus, number> = { same: 0, differs: 0, "only-a": 0, "only-b": 0 };
  for (const r of rows) counts[r.status] += 1;
  return {
    sameReference: a.reference_asset_id === b.reference_asset_id,
    sameSequence: a.active_revision.sequence_sha256 === b.active_revision.sequence_sha256,
    rows,
    counts,
  };
}

// ---------- provenance export ----------

export interface ProvenanceSimulationRef {
  simulation_id: string;
  /** Present only when the run was fetched in this session. */
  result_sha256: string | null;
  genome_revision_id: string | null;
  seed: number | null;
  engine_version: string | null;
}

/**
 * Client-side provenance document built only from real API fields: ids, hashes, edits, timestamps.
 * Contains no transcripts, prompts, audio, or sequence windows.
 */
export function buildProvenanceExport(ws: Workspace, all: readonly Workspace[], simulations: readonly ProvenanceSimulationRef[], now: Date = new Date()) {
  const path = buildBranchPath(ws, all);
  return {
    kind: "diamond-genome-v12-workspace-provenance",
    schema_version: 1,
    exported_at: now.toISOString(),
    notice: "Research use only. In-silico sequence changes; not lab-verified; no clinical or phenotype claim.",
    workspace: {
      workspace_id: ws.workspace_id,
      name: ws.name,
      status: ws.status,
      reference_asset_id: ws.reference_asset_id,
      assembly: ws.assembly,
      official_grch38: ws.official_grch38,
      revision_counter: ws.revision_counter,
      updated_at: ws.updated_at,
    },
    genome_revision: {
      genome_revision_id: ws.active_revision.genome_revision_id,
      parent_revision_id: ws.active_revision.parent_revision_id,
      sequence_sha256: ws.active_revision.sequence_sha256,
      created_at: ws.active_revision.created_at,
      edits: ws.active_revision.edits.map((e) => ({ position: e.position, ref: e.ref, alt: e.alt, current_allele_at_commit: e.current_allele_at_commit })),
    },
    analysis_harness_version_id: ws.active_harness_version_id,
    analysis_harness_note: "Identifies the analysis agent's strategy and tools. It is not part of the biology.",
    branch_path: path.steps.map((s) => ({
      genome_revision_id: s.revisionId,
      parent_revision_id: s.parentRevisionId,
      sequence_sha256: s.sequenceSha256,
      workspace_id: s.workspaceId,
    })),
    branch_path_truncated_at: path.truncatedAt,
    simulations,
  };
}

export function simulationRef(id: string, sim: Pick<Simulation, "result_sha256" | "genome_revision_id" | "seed" | "engine_version"> | undefined): ProvenanceSimulationRef {
  return {
    simulation_id: id,
    result_sha256: sim?.result_sha256 ?? null,
    genome_revision_id: sim?.genome_revision_id ?? null,
    seed: sim?.seed ?? null,
    engine_version: sim?.engine_version ?? null,
  };
}

export function provenanceFilename(ws: Pick<Workspace, "workspace_id">, now: Date = new Date()): string {
  return `provenance-${ws.workspace_id}-${now.toISOString().slice(0, 10)}.json`;
}

/** Summary of a remembered simulation for a card line. Only computed fields. */
export function summariseSimulation(sim: Simulation): string {
  const last = sim.frames[sim.frames.length - 1];
  const fate = last?.extinct ? "extinct" : last ? `final allele frequency ${last.allele_frequency.toFixed(3)}` : "no frames";
  return `${sim.generations_executed} generations, ${Math.round(sim.simulated_years).toLocaleString("en-US")} model years, ${fate}`;
}

/**
 * Newest-first run ids for a workspace: the server's list (returned oldest first) takes precedence,
 * then remembered ids (already newest first) that the server did not report.
 */
export function mergeRunIds(serverOldestFirst: readonly string[], rememberedNewestFirst: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of [...serverOldestFirst].reverse()) if (!out.includes(id)) out.push(id);
  for (const id of rememberedNewestFirst) if (!out.includes(id)) out.push(id);
  return out;
}

// ---------- specimen kind ----------

export type WorkspaceKind = "baseline" | "edited" | "branch" | "archived";
export const KIND_LABEL: Record<WorkspaceKind, string> = { baseline: "At baseline", edited: "Edited", branch: "Branch", archived: "Archived" };

/**
 * One status per workspace. Branch = a fork whose parent revision lives in another workspace, or an
 * unedited workspace that already has a parent. (The list API returns only the active revision, so a
 * branch that was edited afterwards reads as "Edited": its history is in the drawer.)
 */
export function workspaceKind(ws: Workspace, all: readonly Workspace[]): WorkspaceKind {
  if (isArchived(ws)) return "archived";
  const parent = ws.active_revision.parent_revision_id;
  if (parent) {
    const foreign = all.some(
      (o) => o.workspace_id !== ws.workspace_id && (o.active_revision.genome_revision_id === parent || (o.revisions ?? []).some((r) => r.genome_revision_id === parent)),
    );
    if (foreign || ws.edit_count === 0) return "branch";
  }
  return ws.edit_count > 0 ? "edited" : "baseline";
}
