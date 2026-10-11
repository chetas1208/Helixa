/**
 * Pure draft reducer for the Genome Editor. A draft is an ordered list of single-base substitutions on
 * top of a recorded base revision. It is never persisted and never authoritative.
 *
 * Rules (covered by tests):
 *  - one op per position: a newer op for the same position replaces (and is ordered after) the older one;
 *  - an op whose alt equals its ref reverts that position: the existing op is removed, nothing is appended;
 *  - `add` clears the redo stack; invalid ops (non A/C/G/T alt, non-integer / <1 position) are ignored;
 *  - `undo` moves the last op to the redo stack, `redo` moves it back;
 *  - `clear` drops ops + redo but keeps the base; `rebase` only moves the recorded base (ops untouched);
 *  - actions that change nothing return the SAME object (cheap equality for React/zustand).
 */
import type { DraftAction, DraftOp, EditDraft, Workspace } from "../types";
import { isNucleotide } from "./editorModel";

export function emptyDraft(workspace: Pick<Workspace, "workspace_id" | "active_genome_revision_id" | "revision_counter">): EditDraft {
  return {
    workspaceId: workspace.workspace_id,
    baseRevisionId: workspace.active_genome_revision_id,
    baseCounter: workspace.revision_counter,
    ops: [],
    redo: [],
  };
}

function validOp(op: DraftOp): boolean {
  return Number.isInteger(op.position) && op.position >= 1 && isNucleotide(op.alt);
}

export function draftReducer(draft: EditDraft, action: DraftAction): EditDraft {
  switch (action.type) {
    case "add": {
      const op = action.op;
      if (!validOp(op)) return draft;
      const without = draft.ops.filter((o) => o.position !== op.position);
      const existed = without.length !== draft.ops.length;
      if (op.alt === op.ref) {
        // Reverting to the base allele: drop the pending op, add nothing.
        if (!existed) return draft;
        return { ...draft, ops: without, redo: [] };
      }
      return { ...draft, ops: [...without, { ...op }], redo: [] };
    }
    case "undo": {
      if (draft.ops.length === 0) return draft;
      const last = draft.ops[draft.ops.length - 1];
      return { ...draft, ops: draft.ops.slice(0, -1), redo: [...draft.redo, last] };
    }
    case "redo": {
      if (draft.redo.length === 0) return draft;
      const next = draft.redo[draft.redo.length - 1];
      const rest = draft.ops.filter((o) => o.position !== next.position);
      return { ...draft, ops: [...rest, next], redo: draft.redo.slice(0, -1) };
    }
    case "clear": {
      if (draft.ops.length === 0 && draft.redo.length === 0) return draft;
      return { ...draft, ops: [], redo: [] };
    }
    case "rebase": {
      if (draft.baseRevisionId === action.baseRevisionId && draft.baseCounter === action.baseCounter) return draft;
      return { ...draft, baseRevisionId: action.baseRevisionId, baseCounter: action.baseCounter };
    }
    default:
      return draft;
  }
}

export const canUndo = (d: EditDraft | undefined): boolean => !!d && d.ops.length > 0;
export const canRedo = (d: EditDraft | undefined): boolean => !!d && d.redo.length > 0;
export const hasOps = (d: EditDraft | undefined): boolean => !!d && d.ops.length > 0;
/** Draft op currently pending at a position, if any. */
export const opAt = (d: EditDraft | undefined, position: number): DraftOp | undefined => d?.ops.find((o) => o.position === position);
