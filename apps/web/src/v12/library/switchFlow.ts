/**
 * Pure (dependency-injected) draft-save sequence used by the workspace SwitchGuard.
 * Rules: ops are proposed + committed strictly sequentially against the draft's OWN workspace;
 * the first op uses the draft's expected_counter, each later op uses the counter returned by the
 * previous commit; the first failure (409 conflict, REJECTED proposal, any error) stops the run and
 * nothing further is sent. A draft is never applied to any other workspace.
 */
import { isApiError } from "../api/client";
import type { DraftOp, EditDraft, Proposal, Workspace } from "../types";

export interface SaveDeps {
  propose(workspaceId: string, op: DraftOp): Promise<Proposal>;
  commit(workspaceId: string, proposalId: string, expectedCounter: number): Promise<Pick<Workspace, "workspace_id" | "revision_counter" | "active_genome_revision_id">>;
  /** Checked between ops; true => stop cleanly (user cancelled or a newer switch superseded this one). */
  shouldStop(): boolean;
}

export type SaveFailure =
  | { kind: "conflict"; message: string; op: DraftOp }
  | { kind: "rejected"; message: string; op: DraftOp }
  | { kind: "error"; message: string; op: DraftOp }
  | { kind: "stopped"; message: string };

export interface SaveOutcome {
  saved: number;
  /** Ops not committed (still the user's draft). Empty on full success. */
  remaining: DraftOp[];
  /** Latest known revision counter / revision id for the draft's workspace (the draft's own base if nothing was saved). */
  counter: number;
  revisionId: string;
  failure: SaveFailure | null;
}

export async function saveDraftSequentially(draft: EditDraft, deps: SaveDeps): Promise<SaveOutcome> {
  let counter = draft.baseCounter;
  let revisionId = draft.baseRevisionId;
  let saved = 0;
  const fail = (failure: SaveFailure): SaveOutcome => ({ saved, remaining: draft.ops.slice(saved), counter, revisionId, failure });
  for (const op of draft.ops) {
    if (deps.shouldStop()) return fail({ kind: "stopped", message: "Stopped before saving the remaining edits." });
    try {
      const proposal = await deps.propose(draft.workspaceId, op);
      if (proposal.workspace_id !== draft.workspaceId) return fail({ kind: "error", message: "The server answered for a different workspace; nothing was committed.", op });
      if (proposal.status !== "READY") {
        return fail({ kind: "rejected", message: proposal.reason || `Proposal at position ${op.position} was ${proposal.status}.`, op });
      }
      const ws = await deps.commit(draft.workspaceId, proposal.proposal_id, counter);
      if (ws.workspace_id !== draft.workspaceId) return fail({ kind: "error", message: "The server answered for a different workspace.", op });
      counter = ws.revision_counter;
      revisionId = ws.active_genome_revision_id;
      saved += 1;
    } catch (e) {
      if (isApiError(e) && e.conflict) return fail({ kind: "conflict", message: e.detail, op });
      return fail({ kind: "error", message: isApiError(e) ? e.detail : e instanceof Error ? e.message : "Unknown error", op });
    }
  }
  return { saved, remaining: [], counter, revisionId, failure: null };
}

/** Draft left over after a partial save, rebased on the revision the server now reports. */
export function rebaseRemainingDraft(draft: EditDraft, outcome: SaveOutcome): EditDraft | undefined {
  if (outcome.remaining.length === 0) return undefined;
  return { ...draft, ops: outcome.remaining, redo: [], baseCounter: outcome.counter, baseRevisionId: outcome.revisionId };
}
