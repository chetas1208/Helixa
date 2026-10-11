/**
 * Pure Genome Editor model helpers. No React, no three.js, no network.
 * Everything here is deterministic and unit-testable (see docs/frontend/V12_EDITOR_NOTES.md).
 *
 * Coordinates are 1-based inclusive and always refer to the loaded window of the reference.
 */
import type { EditDraft, Nucleotide, Revision, Workspace } from "../types";
import type { DraftOp } from "../types";

export const WINDOW_START = 1;
export const WINDOW_END = 48;
export const SYNTHETIC_REFERENCE_ASSET_ID = "ref_synthetic_chr22";
export const GRCH38_REFERENCE_ASSET_ID = "grch38_slices_ensembl116";

/** Wire edit plus optional V14 reference tag. Extra fields (`ref`, locus, …) are ignored. */
export type AppliedEdit = {
  position: number;
  alt: string;
  ref?: string;
  reference_asset_id?: string | null;
};

export const NUCLEOTIDES: readonly Nucleotide[] = ["A", "C", "G", "T"] as const;

const COMPLEMENT: Record<Nucleotide, Nucleotide> = { A: "T", T: "A", C: "G", G: "C" };

export function isNucleotide(v: unknown): v is Nucleotide {
  return v === "A" || v === "C" || v === "G" || v === "T";
}

/** Watson-Crick partner. Returns null for anything that is not A/C/G/T (never invents a letter). */
export function complementOf(base: string | null | undefined): Nucleotide | null {
  if (!base) return null;
  const up = base.toUpperCase();
  return isNucleotide(up) ? COMPLEMENT[up] : null;
}

/** Hydrogen bonds in the canonical pair: A-T = 2, C-G = 3. Used as a shape cue on rungs. */
export function pairBondCount(base: string): 2 | 3 | null {
  const up = base.toUpperCase();
  if (up === "A" || up === "T") return 2;
  if (up === "C" || up === "G") return 3;
  return null;
}

/** 1-based coordinate -> 0-based index in the window, or -1 when outside the window. */
export function indexOfPosition(position: number, start: number, length: number): number {
  const i = position - start;
  return Number.isInteger(position) && i >= 0 && i < length ? i : -1;
}

export function positionOfIndex(index: number, start: number): number {
  return start + index;
}

export function baseAtPosition(bases: string, start: number, position: number): string | null {
  const i = indexOfPosition(position, start, bases.length);
  return i < 0 ? null : bases[i];
}

function editMatchesReference(edit: AppliedEdit, referenceAssetId: string): boolean {
  const tagged = edit.reference_asset_id;
  if (tagged == null || tagged === "") return referenceAssetId === SYNTHETIC_REFERENCE_ASSET_ID;
  return tagged === referenceAssetId;
}

function paintEdits(baseline: string, start: number, edits: readonly AppliedEdit[]): string {
  const out = baseline.split("");
  for (const e of edits) {
    const i = indexOfPosition(e.position, start, out.length);
    if (i >= 0 && isNucleotide(e.alt)) out[i] = e.alt;
  }
  return out.join("");
}

/**
 * Apply saved edits to a baseline window. Edits outside the window are ignored.
 * Edits tagged with another `reference_asset_id` are ignored so synthetic chr22
 * positions never collide with GRCh38 slices. Untagged edits are synthetic.
 */
export function applySavedEdits(
  baseline: string,
  start: number,
  edits: readonly AppliedEdit[],
  referenceAssetId: string = SYNTHETIC_REFERENCE_ASSET_ID,
): string {
  return paintEdits(baseline, start, edits.filter((e) => editMatchesReference(e, referenceAssetId)));
}

/** Apply draft operations on top of the saved bases. Later ops win; drafts are for the current window (no reference filter). */
export function applyDraftOps(saved: string, start: number, ops: readonly Pick<DraftOp, "position" | "alt">[]): string {
  return paintEdits(saved, start, ops);
}

/** Positions (1-based) where two equal-length strings differ. */
export function diffPositions(a: string, b: string, start: number): number[] {
  const out: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(start + i);
  return out;
}

/**
 * Draft ops that would put the workspace back on the baseline sequence (a NEW version once
 * confirmed; saved versions are never touched). One op per position where saved differs from baseline.
 */
export function restoreBaselineOps(savedBases: string, baselineBases: string, start: number, origin: DraftOp["origin"] = "manual"): DraftOp[] {
  const ops: DraftOp[] = [];
  const n = Math.min(savedBases.length, baselineBases.length);
  for (let i = 0; i < n; i++) {
    const to = baselineBases[i];
    if (savedBases[i] !== to && isNucleotide(to) && isNucleotide(savedBases[i])) {
      ops.push({ position: start + i, ref: savedBases[i], alt: to, origin });
    }
  }
  return ops;
}

/**
 * After the base revision changed, re-read each op's `ref` from the new saved bases and drop ops that
 * became no-ops (alt now equals the allele) or fall outside the window.
 */
export function refreshOps(ops: readonly DraftOp[], savedBases: string, start: number): DraftOp[] {
  const out: DraftOp[] = [];
  for (const op of ops) {
    const cur = baseAtPosition(savedBases, start, op.position);
    if (cur && isNucleotide(cur) && cur !== op.alt) out.push({ ...op, ref: cur });
  }
  return out;
}

export interface BaseSelectionInfo {
  position: number;
  index: number;
  /** Observed reference nucleotide at this coordinate (baseline). */
  reference: string;
  /** Allele in the saved (committed) revision. */
  saved: string;
  /** Allele shown in the draft preview (equals saved when not edited). */
  draft: string;
  complementOfReference: string | null;
  complementOfDraft: string | null;
  /** Proposed alt for this position (draft alt if edited, else null). */
  proposedAlt: Nucleotide | null;
  changedInSaved: boolean;
  changedInDraft: boolean;
}

export function describeSelection(
  position: number,
  start: number,
  baselineBases: string,
  savedBases: string,
  draftBases: string,
  ops: readonly DraftOp[],
): BaseSelectionInfo | null {
  const index = indexOfPosition(position, start, baselineBases.length);
  if (index < 0) return null;
  const reference = baselineBases[index];
  const saved = savedBases[index] ?? reference;
  const draft = draftBases[index] ?? saved;
  const op = ops.find((o) => o.position === position);
  return {
    position,
    index,
    reference,
    saved,
    draft,
    complementOfReference: complementOf(reference),
    complementOfDraft: complementOf(draft),
    proposedAlt: op ? op.alt : null,
    changedInSaved: saved !== reference,
    changedInDraft: draft !== saved,
  };
}

/** "A>T" style label that is also readable aloud. */
export function describeChange(op: Pick<DraftOp, "position" | "ref" | "alt">, contig: string): string {
  return `${contig}:${op.position} ${op.ref} to ${op.alt} (single-base substitution)`;
}

export type SubstitutionClass = "transition" | "transversion" | "none";
/** Purine<->purine / pyrimidine<->pyrimidine = transition. A pure sequence-level fact, no biology implied. */
export function substitutionClass(ref: string, alt: string): SubstitutionClass {
  const purine = (b: string) => b === "A" || b === "G";
  if (!isNucleotide(ref) || !isNucleotide(alt) || ref === alt) return "none";
  return purine(ref) === purine(alt) ? "transition" : "transversion";
}

// ---------- drafts vs workspace ----------

export type DraftConflict =
  | { kind: "none" }
  | { kind: "stale-empty" } // draft has no ops: silently rebase
  | { kind: "remote-change"; draftCounter: number; remoteCounter: number; draftRevisionId: string; remoteRevisionId: string };

/** Compare the draft's recorded base with the authoritative workspace. */
export function detectDraftConflict(
  draft: Pick<EditDraft, "baseCounter" | "baseRevisionId" | "ops"> | undefined,
  ws: Pick<Workspace, "revision_counter" | "active_genome_revision_id"> | undefined,
): DraftConflict {
  if (!draft || !ws) return { kind: "none" };
  const same = draft.baseCounter === ws.revision_counter && draft.baseRevisionId === ws.active_genome_revision_id;
  if (same) return { kind: "none" };
  if (draft.ops.length === 0) return { kind: "stale-empty" };
  return {
    kind: "remote-change",
    draftCounter: draft.baseCounter,
    remoteCounter: ws.revision_counter,
    draftRevisionId: draft.baseRevisionId,
    remoteRevisionId: ws.active_genome_revision_id,
  };
}

export type EditorStatus = "Baseline" | "Draft" | "Validated" | "Unsupported" | "Analysis pending";

export interface StatusInput {
  editCount: number;
  draftOpCount: number;
  validating: boolean;
  /** Last outcome of a prompt/proposal: unsupported/rejected beats Draft until the next action. */
  unsupported: boolean;
}

/** Pure status chip derivation. Priority: pending > unsupported > draft > validated > baseline. */
export function deriveEditorStatus(i: StatusInput): EditorStatus {
  if (i.validating) return "Analysis pending";
  if (i.unsupported) return "Unsupported";
  if (i.draftOpCount > 0) return "Draft";
  if (i.editCount > 0) return "Validated";
  return "Baseline";
}

export const STATUS_HINT: Record<EditorStatus, string> = {
  Baseline: "No saved edits and no draft: the loaded reference window.",
  Draft: "Unsaved in-silico sequence change. Nothing is saved until you confirm.",
  Validated: "Saved version. The backend reference check passed; no phenotype or protein model ran.",
  Unsupported: "This request is not a supported single-base substitution, or the check rejected it.",
  "Analysis pending": "Waiting for the backend to validate the proposed change.",
};

/** Stable cache key for a proposal request. Includes the counter because the backend ties proposals to it. */
export function proposalKey(workspaceId: string, counter: number, op: Pick<DraftOp, "position" | "alt">): string {
  return `${workspaceId}|${counter}|${op.position}|${op.alt}`;
}

/** Latest saved-revision sequence from a workspace, falling back to edits applied on the baseline. */
export function savedBasesOf(baseline: string, start: number, revision: Pick<Revision, "edits"> | undefined): string {
  return revision ? applySavedEdits(baseline, start, revision.edits) : baseline;
}

/** Human summary of a draft for the status area. */
export function draftSummary(ops: readonly DraftOp[]): string {
  if (ops.length === 0) return "No unsaved changes";
  if (ops.length === 1) return `1 unsaved base change (position ${ops[0].position})`;
  return `${ops.length} unsaved base changes`;
}
