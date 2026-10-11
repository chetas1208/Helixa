/**
 * Workspace switch guard.
 *  - `useGuardedWorkspaceSwitch()` returns `(workspaceId) => Promise<boolean>`; true only when the
 *    server accepted `select` and the session's active workspace is now `workspaceId`.
 *  - `<SwitchGuardDialog />` must be mounted once near the app root (extra instances stay silent).
 * An unsaved draft on the active workspace triggers Save draft / Discard / Cancel switch.
 * Latest switch wins: starting a new switch cancels the open prompt and aborts/ignores older selects.
 */
import { useCallback, useEffect, useId, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { apiGetParsed, isAbortError, isApiError } from "../api/client";
import { useCommitEdit, useProposeEdit, useSelectWorkspace } from "../api/hooks";
import { qk } from "../api/queryKeys";
import { WorkspaceListSchema } from "../api/schemas";
import { createLatestGate, createSerialQueue } from "../state/raceGuard";
import { useSession } from "../state/session";
import { isWorkspaceId } from "../state/urlParams";
import { rebaseRemainingDraft, saveDraftSequentially } from "./switchFlow";
import type { EditDraft, WorkspaceList } from "../types";

type Choice = "save" | "discard" | "cancel" | "superseded";
type Phase = "ask" | "saving" | "problem";

interface GuardRequest {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  opCount: number;
  phase: Phase;
  message: string | null;
  savedCount: number;
}

interface GuardStore {
  request: GuardRequest | null;
  /** Last failed switch (select rejected, conflict). Shown by the Library tab; cleared on next attempt. */
  lastError: string | null;
  instances: string[];
  patch: (p: Partial<GuardRequest>) => void;
  setRequest: (r: GuardRequest | null) => void;
  setLastError: (m: string | null) => void;
  register: (id: string) => () => void;
}

export const useSwitchGuardStore = create<GuardStore>((set) => ({
  request: null,
  lastError: null,
  instances: [],
  patch: (p) => set((s) => (s.request ? { request: { ...s.request, ...p } } : s)),
  setRequest: (request) => set({ request }),
  setLastError: (lastError) => set({ lastError }),
  register: (id) => {
    set((s) => ({ instances: [...s.instances, id] }));
    return () => set((s) => ({ instances: s.instances.filter((x) => x !== id) }));
  },
}));

// ---- module-level coordination (one switch pipeline per page) ----
const gate = createLatestGate();
const selectQueue = createSerialQueue();
/** Switches that have entered the select pipeline and not settled. An aborted fetch may still reach the server, so older selects are never aborted: they finish in order and the latest one wins. */
let selectsInFlight = 0;
let pendingChoice: ((c: Choice) => void) | null = null;
let stopRequested = false;

function chooseGuard(c: Choice): void {
  const fn = pendingChoice;
  pendingChoice = null;
  fn?.(c);
}
function waitChoice(): Promise<Choice> {
  return new Promise((resolve) => {
    pendingChoice = resolve;
  });
}
function supersedeOpenPrompt(): void {
  chooseGuard("superseded");
  useSwitchGuardStore.getState().setRequest(null);
}

export function useGuardedWorkspaceSwitch(): (workspaceId: string) => Promise<boolean> {
  const qc = useQueryClient();
  const propose = useProposeEdit();
  const commit = useCommitEdit();
  const select = useSelectWorkspace();
  const ref = useRef({ propose: propose.mutateAsync, commit: commit.mutateAsync, select: select.mutateAsync, qc });
  ref.current = { propose: propose.mutateAsync, commit: commit.mutateAsync, select: select.mutateAsync, qc };

  return useCallback(async (toId: string): Promise<boolean> => {
    const { propose: doPropose, commit: doCommit, select: doSelect, qc: client } = ref.current;
    const guard = useSwitchGuardStore.getState();
    const session = useSession.getState();
    const fromId = session.activeWorkspaceId;

    // A newer intent supersedes everything older: close the prompt; older selects become no-ops for the client.
    const token = gate.begin();
    supersedeOpenPrompt();
    guard.setLastError(null);

    if (!isWorkspaceId(toId)) {
      guard.setLastError("That workspace id is not valid.");
      return false;
    }
    // Returning to the current workspace while another select is in flight must still reach the server (A -> B -> A).
    if (toId === fromId && selectsInFlight === 0) return true;

    const list = client.getQueryData<WorkspaceList>(qk.workspaces);
    const nameOf = (id: string | null) => list?.workspaces.find((w) => w.workspace_id === id)?.name ?? id ?? "workspace";

    const draft = fromId ? session.drafts[fromId] : undefined;
    const hasDraft = !!fromId && !!draft && draft.workspaceId === fromId && draft.ops.length > 0;

    if (hasDraft && fromId && draft) {
      if (useSwitchGuardStore.getState().instances.length === 0) {
        // Fail safe: never switch away from unsaved edits, and never wait for a prompt nobody can show.
        guard.setLastError("You have unsaved edits. Return to the Genome Editor to save or discard them before switching workspace.");
        return false;
      }
      stopRequested = false;
      guard.setRequest({ fromId, toId, fromName: nameOf(fromId), toName: nameOf(toId), opCount: draft.ops.length, phase: "ask", message: null, savedCount: 0 });
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const choice = await waitChoice();
        if (choice === "superseded" || !gate.isCurrent(token)) return false;
        if (choice === "cancel") {
          useSwitchGuardStore.getState().setRequest(null);
          return false;
        }
        if (choice === "discard") {
          useSession.getState().setDraft(fromId, undefined);
          break;
        }
        // choice === "save": propose + commit sequentially against the draft's own workspace.
        stopRequested = false;
        useSwitchGuardStore.getState().patch({ phase: "saving", message: null });
        const live: EditDraft | undefined = useSession.getState().drafts[fromId];
        if (!live || live.workspaceId !== fromId) break;
        const outcome = await saveDraftSequentially(live, {
          propose: (wsId, op) => doPropose({ workspaceId: wsId, position: op.position, alt: op.alt, note: `draft save (${op.origin})` }),
          commit: (wsId, proposalId, expectedCounter) => doCommit({ workspaceId: wsId, proposalId, expectedCounter }),
          shouldStop: () => stopRequested || !gate.isCurrent(token),
        });
        useSession.getState().setDraft(fromId, rebaseRemainingDraft(live, outcome));
        if (!gate.isCurrent(token)) return false;
        if (!outcome.failure) {
          if (stopRequested) {
            useSwitchGuardStore.getState().setRequest(null);
            return false; // user asked to stop: edits are saved, but do not switch
          }
          break;
        }
        if (outcome.failure.kind === "stopped") {
          useSwitchGuardStore.getState().setRequest(null);
          return false;
        }
        const f = outcome.failure;
        const label = f.kind === "conflict" ? "Conflict" : f.kind === "rejected" ? "Edit rejected" : "Save failed";
        useSwitchGuardStore.getState().patch({
          phase: "problem",
          savedCount: outcome.saved,
          opCount: outcome.remaining.length,
          message: `${label}: ${f.message.trim().replace(/[.\s]+$/, "")}.${outcome.saved > 0 ? ` ${outcome.saved} edit(s) were saved before this.` : ""} Remaining edits stay as your unsaved draft; the workspace was not switched.`,
        });
      }
      useSwitchGuardStore.getState().setRequest(null);
    }

    if (!gate.isCurrent(token)) return false;

    // Authoritative switch: fresh counter -> select (serialised, latest wins) -> then local state.
    selectsInFlight += 1;
    try {
      const result = await selectQueue.run(async () => {
        if (!gate.isCurrent(token)) return "skipped" as const;
        let counter: number | null = null;
        try {
          const fresh = await client.fetchQuery({
            queryKey: qk.workspaces,
            staleTime: 0,
            queryFn: ({ signal }) => apiGetParsed("/api/v10/genome/workspaces", WorkspaceListSchema, signal),
          });
          counter = fresh.workspaces.find((w) => w.workspace_id === toId)?.revision_counter ?? null;
          if (counter === null) throw new Error("That workspace no longer exists on the server.");
        } catch (e) {
          if (e instanceof Error && !isApiError(e)) throw e;
          counter = null; // list refresh failed: select without a counter, the server still validates the id
        }
        if (!gate.isCurrent(token)) return "skipped" as const;
        return doSelect({ workspaceId: toId, expectedCounter: counter });
      });
      if (result === "skipped" || !gate.isCurrent(token)) return false;
      useSession.getState().setActiveWorkspaceId(toId);
      return true;
    } catch (e) {
      if (isAbortError(e) || !gate.isCurrent(token)) return false;
      const msg = isApiError(e) ? (e.conflict ? `Conflict: ${e.detail}. The workspace changed on the server; refreshed list shown.` : e.detail) : e instanceof Error ? e.message : "Switch failed";
      useSwitchGuardStore.getState().setLastError(`Could not switch workspace. ${msg}`);
      client.invalidateQueries({ queryKey: qk.workspaces });
      return false;
    } finally {
      selectsInFlight -= 1;
    }
  }, []);
}

const btn = "inline-flex min-h-[40px] items-center justify-center rounded-md border px-3.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-45";

export function SwitchGuardDialog() {
  const id = useId();
  const instances = useSwitchGuardStore((s) => s.instances);
  const register = useSwitchGuardStore((s) => s.register);
  const request = useSwitchGuardStore((s) => s.request);
  useEffect(() => register(id), [id, register]);

  // Only the first mounted instance renders, so mounting a fallback instance in a tab is safe.
  if (instances[0] !== id || !request) return null;
  const busy = request.phase === "saving";
  const cancel = () => {
    if (busy) stopRequested = true; // let the in-flight commit finish, then stop
    else chooseGuard("cancel");
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && cancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby="switch-guard-desc"
          className="glass-strong fixed left-1/2 top-1/2 z-[71] w-[min(92vw,36rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-[#0b1220]/95 p-5 shadow-2xl"
        >
          <Dialog.Title className="text-base font-semibold text-slate-50">Unsaved edits in {request.fromName}</Dialog.Title>
          <Dialog.Description id="switch-guard-desc" className="mt-2 text-sm leading-relaxed text-slate-300">
            {request.phase === "problem"
              ? "The draft could not be saved."
              : `You have ${request.opCount} unsaved in-silico edit${request.opCount === 1 ? "" : "s"}. Switching to ${request.toName} will not carry them over: a draft belongs to one workspace only.`}
          </Dialog.Description>
          <div role="status" aria-live="polite" className="mt-3 text-sm">
            {busy && <p className="text-cyan-200">Saving edits one at a time...</p>}
            {request.message && <p className="rounded-md border border-amber-300/40 bg-amber-400/10 p-2.5 text-amber-100">{request.message}</p>}
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className={`${btn} border-white/20 text-slate-200 hover:bg-white/10`} onClick={cancel}>
              {busy ? "Stop after current edit" : "Cancel switch"}
            </button>
            <button type="button" className={`${btn} border-rose-300/40 text-rose-100 hover:bg-rose-400/10`} disabled={busy} onClick={() => chooseGuard("discard")}>
              Discard draft and switch
            </button>
            {request.phase !== "problem" && (
              <button type="button" autoFocus className={`${btn} border-cyan-300/60 bg-cyan-400/15 text-cyan-50 hover:bg-cyan-400/25`} disabled={busy} onClick={() => chooseGuard("save")}>
                Save draft, then switch
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-300">Saving creates real revisions in {request.fromName} (research use, in-silico only).</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
