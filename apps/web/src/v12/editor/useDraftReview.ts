import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useCommitEdit, useProposeEdit } from "../api/hooks";
import type { DraftAction, DraftOp, EditDraft, Proposal, Workspace } from "../types";
import { proposalKey } from "./editorModel";

export type ProposalEntry =
  | { state: "pending" }
  | { state: "ready"; proposal: Proposal }
  | { state: "needs_review"; proposal: Proposal }
  | { state: "rejected"; proposal: Proposal }
  | { state: "error"; message: string; offline: boolean };

export type SavePhase =
  | { phase: "idle" }
  | { phase: "saving"; done: number; total: number }
  | { phase: "saved"; saved: number; revisionId: string; counter: number }
  | { phase: "conflict"; message: string; done: number; total: number }
  | { phase: "error"; message: string; done: number; total: number };

export interface DraftReview {
  entries: Record<string, ProposalEntry>;
  keyOf: (op: DraftOp) => string;
  validating: boolean;
  anyRejected: boolean;
  anyError: boolean;
  allValidated: boolean;
  save: SavePhase;
  commit: () => Promise<void>;
  dismissSave: () => void;
  retryValidation: () => void;
}

/**
 * Server-side validation + sequential commit of a draft. Pure orchestration around the frozen hooks:
 *  - validation = POST proposals {position, alt, note} per draft op (HYPOTHESIS until committed);
 *  - commit = one commit per op with the running `expected_counter` (the backend commits one substitution at a time);
 *  - 409 never retries silently; the remaining ops stay in the draft; saved ops leave the draft and the base advances.
 */
export function useDraftReview(args: {
  open: boolean;
  workspace: Workspace | undefined;
  draft: EditDraft | undefined;
  blocked: boolean; // a remote-change conflict is pending
  dispatchDraft: (a: DraftAction) => void;
}): DraftReview {
  const { open, workspace, draft, blocked, dispatchDraft } = args;
  const propose = useProposeEdit();
  const commitMut = useCommitEdit();
  const [entries, setEntries] = useState<Record<string, ProposalEntry>>({});
  const [save, setSave] = useState<SavePhase>({ phase: "idle" });
  const [nonce, setNonce] = useState(0);
  const inflight = useRef(new Set<string>());
  const wsId = workspace?.workspace_id;
  const counter = draft?.baseCounter;

  const keyOf = useCallback((op: DraftOp) => proposalKey(wsId ?? "", counter ?? 0, op), [wsId, counter]);

  // validate every draft op once per (workspace, counter, position, alt)
  useEffect(() => {
    if (!open || blocked || !wsId || !draft || save.phase === "saving") return;
    for (const op of draft.ops) {
      const k = proposalKey(wsId, draft.baseCounter, op);
      if (entries[k] || inflight.current.has(k)) continue;
      inflight.current.add(k);
      setEntries((e) => ({ ...e, [k]: { state: "pending" } }));
      propose
        .mutateAsync({ workspaceId: wsId, position: op.position, alt: op.alt, note: `${op.origin} edit` })
        .then((p) => {
          const st = p.status === "REJECTED" ? "rejected" : p.status === "READY" ? "ready" : "needs_review";
          setEntries((e) => ({ ...e, [k]: { state: st, proposal: p } as ProposalEntry }));
        })
        .catch((err: unknown) => {
          const offline = err instanceof ApiError && err.status === 0;
          const message = err instanceof ApiError ? err.detail : "Validation is unavailable.";
          setEntries((e) => ({ ...e, [k]: { state: "error", message, offline } }));
        })
        .finally(() => inflight.current.delete(k));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, blocked, wsId, draft?.ops, draft?.baseCounter, nonce, save.phase]);

  const retryValidation = useCallback(() => {
    setEntries((e) => {
      const next: Record<string, ProposalEntry> = {};
      for (const [k, v] of Object.entries(e)) if (v.state !== "error") next[k] = v;
      return next;
    });
    setNonce((n) => n + 1);
  }, []);

  const statuses = (draft?.ops ?? []).map((op) => entries[wsId ? proposalKey(wsId, draft?.baseCounter ?? 0, op) : ""]);
  const validating = open && (draft?.ops.length ?? 0) > 0 && statuses.some((s) => !s || s.state === "pending");
  const anyRejected = statuses.some((s) => s?.state === "rejected");
  const anyError = statuses.some((s) => s?.state === "error");
  const allValidated = (draft?.ops.length ?? 0) > 0 && statuses.every((s) => s && (s.state === "ready" || s.state === "needs_review"));

  const commit = useCallback(async () => {
    if (!wsId || !draft || draft.ops.length === 0) return;
    const ops = [...draft.ops];
    let expected = draft.baseCounter;
    let last: Workspace | null = null;
    setSave({ phase: "saving", done: 0, total: ops.length });
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const entry = entries[proposalKey(wsId, draft.baseCounter, op)];
      if (!entry || (entry.state !== "ready" && entry.state !== "needs_review")) {
        setSave({ phase: "error", message: "A change in the draft has not been validated yet.", done: i, total: ops.length });
        return;
      }
      try {
        const ws = await commitMut.mutateAsync({ workspaceId: wsId, proposalId: entry.proposal.proposal_id, expectedCounter: expected });
        last = ws;
        expected = ws.revision_counter;
        // saved ops leave the draft; the base advances to the new authoritative revision
        dispatchDraft({ type: "add", op: { position: op.position, ref: op.alt, alt: op.alt, origin: op.origin } });
        dispatchDraft({ type: "rebase", baseRevisionId: ws.active_genome_revision_id, baseCounter: ws.revision_counter });
        setSave({ phase: "saving", done: i + 1, total: ops.length });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setSave({ phase: "conflict", message: err.detail, done: i, total: ops.length });
        } else {
          setSave({ phase: "error", message: err instanceof ApiError ? err.detail : "Saving failed.", done: i, total: ops.length });
        }
        return;
      }
    }
    if (last) setSave({ phase: "saved", saved: ops.length, revisionId: last.active_genome_revision_id, counter: last.revision_counter });
  }, [wsId, draft, entries, commitMut, dispatchDraft]);

  const dismissSave = useCallback(() => setSave({ phase: "idle" }), []);

  return { entries, keyOf, validating, anyRejected, anyError, allValidated, save, commit, dismissSave, retryValidation };
}
