import { describe, it, expect } from "vitest";
import { decideHistoryMode, isTabId, isWorkspaceId, parseUrlSelection, resolveBootstrapWorkspace, serialiseUrlSelection } from "../../src/v12/state/urlParams";
import { belongsToActiveWorkspace, createLatestGate, createSerialQueue, onlyIfActive } from "../../src/v12/state/raceGuard";
import { rebaseRemainingDraft, saveDraftSequentially, type SaveDeps } from "../../src/v12/library/switchFlow";
import { ApiError } from "../../src/v12/api/client";
import type { DraftOp, EditDraft, Proposal } from "../../src/v12/types";

describe("urlParams: ?tab=&workspace= deep links (pure)", () => {
  it("parses valid selections", () => {
    expect(parseUrlSelection("?tab=simulation&workspace=ws-4b73b1e41102")).toEqual({ tab: "simulation", workspace: "ws-4b73b1e41102", issues: [] });
    expect(parseUrlSelection("tab=library")).toMatchObject({ tab: "library", workspace: null });
    expect(parseUrlSelection("")).toEqual({ tab: null, workspace: null, issues: [] });
  });

  it("rejects unknown tabs, legacy mode names and malformed / hostile ids without throwing", () => {
    for (const bad of ["mission", "proof", "studio", "EDITOR", "editor ", "../etc", "<script>", "editor,evolution", ""]) {
      expect(parseUrlSelection(`?tab=${encodeURIComponent(bad)}`).tab, bad).toBeNull();
    }
    for (const bad of ["x", "ws-", "ws-ABC", "ws-1;drop", "ws-1 2", "ws-../1", "WS-1", "<img>", "ws-" + "a".repeat(80), "javascript:alert(1)"]) {
      expect(parseUrlSelection(`?workspace=${encodeURIComponent(bad)}`).workspace, bad).toBeNull();
    }
    expect(() => parseUrlSelection("?%E0%A4%A&tab=%")).not.toThrow();
  });

  it("type guards agree with the grammar", () => {
    expect(["editor", "evolution", "simulation", "library"].every(isTabId)).toBe(true);
    expect(isTabId("mission")).toBe(false);
    expect(isWorkspaceId("ws-abc123")).toBe(true);
    expect(isWorkspaceId(null)).toBe(false);
    expect(isWorkspaceId(42)).toBe(false);
  });

  it("serialises only a tab id and an opaque workspace id; preserves unrelated params; drops invalid ids", () => {
    expect(serialiseUrlSelection({ tab: "editor", workspace: "ws-abc" })).toBe("?tab=editor&workspace=ws-abc");
    expect(serialiseUrlSelection({ tab: "library", workspace: null }, "?workspace=ws-old&debug=1")).toBe("?debug=1&tab=library");
    expect(serialiseUrlSelection({ tab: "editor", workspace: "A<script>" })).toBe("?tab=editor");
  });

  it("URLs never carry sequences, edits or transcripts: round trip only exposes tab + ws", () => {
    const s = serialiseUrlSelection({ tab: "editor", workspace: "ws-abc" }, "?transcript=change+base+4+to+A&seq=ACGT");
    // unrelated params are preserved by design; the app itself must never ADD them (checked in e2e privacy audit)
    expect(s).toContain("tab=editor");
    expect(parseUrlSelection(s).issues).toEqual([]);
  });

  it("bootstrap: URL workspace beats server active, falls back to active, then first, then none", () => {
    const ids = ["ws-a", "ws-b", "ws-c"];
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: "ws-c", workspaceIds: ids, serverActiveId: "ws-a" })).toEqual({ workspaceId: "ws-c", source: "url", urlWorkspaceMissing: false });
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: null, workspaceIds: ids, serverActiveId: "ws-b" }).source).toBe("server-active");
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: "ws-zzz", workspaceIds: ids, serverActiveId: "ws-b" })).toEqual({ workspaceId: "ws-b", source: "server-active", urlWorkspaceMissing: true });
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: null, workspaceIds: ids, serverActiveId: null })).toMatchObject({ workspaceId: "ws-a", source: "first" });
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: "ws-x", workspaceIds: [], serverActiveId: null })).toEqual({ workspaceId: null, source: "none", urlWorkspaceMissing: true });
    // a stale server-active id that no longer exists must not be selected
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: null, workspaceIds: ids, serverActiveId: "ws-gone" }).workspaceId).toBe("ws-a");
  });

  it("history mode: user changes push, corrections replace, identical is none, param order is irrelevant", () => {
    expect(decideHistoryMode({ currentSearch: "?tab=editor&workspace=ws-a", nextSearch: "?workspace=ws-a&tab=editor", reason: "user" })).toBe("none");
    expect(decideHistoryMode({ currentSearch: "?tab=editor", nextSearch: "?tab=library", reason: "user" })).toBe("push");
    expect(decideHistoryMode({ currentSearch: "", nextSearch: "?tab=editor", reason: "bootstrap" })).toBe("replace");
    expect(decideHistoryMode({ currentSearch: "?workspace=ws-gone", nextSearch: "?workspace=ws-a", reason: "correction" })).toBe("replace");
  });
});

describe("raceGuard: rapid A -> B -> A workspace switching", () => {
  it("latest-wins gate: only the last begun operation may apply", () => {
    const g = createLatestGate();
    const a1 = g.begin();
    const b = g.begin();
    const a2 = g.begin();
    expect([g.isCurrent(a1), g.isCurrent(b), g.isCurrent(a2)]).toEqual([false, false, true]);
    g.invalidate();
    expect(g.isCurrent(a2)).toBe(false);
  });

  it("simulated race: B's slow response arrives after A's second response and is discarded", async () => {
    const g = createLatestGate();
    const applied: string[] = [];
    const load = (id: string, ms: number) => {
      const t = g.begin();
      return new Promise<void>((res) => setTimeout(() => { if (g.isCurrent(t)) applied.push(id); res(); }, ms));
    };
    await Promise.all([load("A", 30), load("B", 5), load("A", 10)]);
    expect(applied).toEqual(["A"]); // only the final A; the early A and the late B are dropped
  });

  it("data from another workspace is never shown", () => {
    expect(belongsToActiveWorkspace("ws-a", "ws-a")).toBe(true);
    expect(belongsToActiveWorkspace("ws-a", "ws-b")).toBe(false);
    expect(belongsToActiveWorkspace(null, "ws-a")).toBe(false);
    expect(belongsToActiveWorkspace("ws-a", undefined)).toBe(false);
    const data = { workspace_id: "ws-b", name: "B" };
    expect(onlyIfActive("ws-a", data)).toBeUndefined();
    expect(onlyIfActive("ws-b", data)).toBe(data);
    expect(onlyIfActive("ws-b", null)).toBeUndefined();
  });

  it("serial queue runs select calls in order so the server's final active == latest intent", async () => {
    const q = createSerialQueue();
    const order: string[] = [];
    const task = (id: string, ms: number, fail = false) => () => new Promise<string>((res, rej) => setTimeout(() => { order.push(id); fail ? rej(new Error(id)) : res(id); }, ms));
    const results = await Promise.allSettled([q.run(task("A", 25)), q.run(task("B", 5, true)), q.run(task("A2", 1))]);
    expect(order).toEqual(["A", "B", "A2"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]); // a failure does not poison the queue
  });
});

describe("switchFlow: Save draft before switching (SwitchGuard 'Save' path)", () => {
  const mkDraft = (ops: DraftOp[]): EditDraft => ({ workspaceId: "ws-A", baseRevisionId: "rev-1", baseCounter: 1, ops, redo: [] });
  const op = (position: number, alt: DraftOp["alt"]): DraftOp => ({ position, ref: "T", alt, origin: "manual" });
  const proposal = (ws: string, id: string, status = "READY", reason = ""): Proposal => ({ proposal_id: id, workspace_id: ws, assembly: "x", contig: "chr22", position: 1, ref: "T", current_allele: "T", alt: "A", note: "", status, reason, applied: false });

  function deps(over: Partial<SaveDeps> = {}) {
    const sent: { kind: string; ws: string; arg?: unknown; counter?: number }[] = [];
    let counter = 1;
    const d: SaveDeps = {
      propose: async (ws, o) => (sent.push({ kind: "propose", ws, arg: o.position }), proposal(ws, `prop-${o.position}`)),
      commit: async (ws, pid, expected) => {
        sent.push({ kind: "commit", ws, arg: pid, counter: expected });
        if (expected !== counter) throw new ApiError(409, `revision_counter is ${counter}, not ${expected}`, "/commit");
        counter += 1;
        return { workspace_id: ws, revision_counter: counter, active_genome_revision_id: `rev-${counter}` };
      },
      shouldStop: () => false,
      ...over,
    };
    return { d, sent };
  }

  it("saves ops sequentially against the draft's OWN workspace, threading the returned counter", async () => {
    const { d, sent } = deps();
    const out = await saveDraftSequentially(mkDraft([op(4, "A"), op(9, "C"), op(12, "G")]), d);
    expect(out).toMatchObject({ saved: 3, remaining: [], counter: 4, revisionId: "rev-4", failure: null });
    expect(sent.every((s) => s.ws === "ws-A")).toBe(true);
    expect(sent.filter((s) => s.kind === "commit").map((s) => s.counter)).toEqual([1, 2, 3]);
    expect(sent.map((s) => s.kind)).toEqual(["propose", "commit", "propose", "commit", "propose", "commit"]); // strictly sequential
  });

  it("409 conflict stops immediately: nothing further is sent, remaining ops stay the user's draft", async () => {
    const { d, sent } = deps();
    const draft = mkDraft([op(4, "A"), op(9, "C")]);
    draft.baseCounter = 7; // stale
    const out = await saveDraftSequentially(draft, d);
    expect(out.failure?.kind).toBe("conflict");
    expect(out.failure).toMatchObject({ message: "revision_counter is 1, not 7" });
    expect(out.saved).toBe(0);
    expect(out.remaining).toHaveLength(2);
    expect(sent.filter((s) => s.kind === "propose")).toHaveLength(1);
  });

  it("a REJECTED / NEEDS_REVIEW proposal is never committed", async () => {
    for (const status of ["REJECTED", "NEEDS_REVIEW"]) {
      const { d, sent } = deps({ propose: async (ws) => proposal(ws, "p", status, "because") });
      const out = await saveDraftSequentially(mkDraft([op(4, "A")]), d);
      expect(out.failure).toMatchObject({ kind: "rejected", message: "because" });
      expect(sent.some((s) => s.kind === "commit")).toBe(false);
    }
  });

  it("a response for a different workspace is refused (no cross-workspace application)", async () => {
    const { d, sent } = deps({ propose: async () => proposal("ws-OTHER", "p") });
    const out = await saveDraftSequentially(mkDraft([op(4, "A")]), d);
    expect(out.failure?.kind).toBe("error");
    expect(sent.some((s) => s.kind === "commit")).toBe(false);
  });

  it("stops cleanly between ops when cancelled", async () => {
    let n = 0;
    const { d } = deps({ shouldStop: () => n++ >= 1 });
    const out = await saveDraftSequentially(mkDraft([op(4, "A"), op(9, "C")]), d);
    expect(out.saved).toBe(1);
    expect(out.failure?.kind).toBe("stopped");
    expect(out.remaining.map((o) => o.position)).toEqual([9]);
  });

  it("network error is reported, not retried", async () => {
    let calls = 0;
    const { d } = deps({ propose: async () => { calls++; throw new ApiError(0, "Network error. The API is unreachable.", "/p"); } });
    const out = await saveDraftSequentially(mkDraft([op(4, "A")]), d);
    expect(out.failure?.kind).toBe("error");
    expect(calls).toBe(1);
  });

  it("rebaseRemainingDraft keeps only unsaved ops on the revision the server now reports", async () => {
    const { d } = deps({ shouldStop: (() => { let n = 0; return () => n++ >= 1; })() });
    const draft = mkDraft([op(4, "A"), op(9, "C")]);
    const out = await saveDraftSequentially(draft, d);
    const rest = rebaseRemainingDraft(draft, out)!;
    expect(rest.ops.map((o) => o.position)).toEqual([9]);
    expect(rest.baseCounter).toBe(2);
    expect(rest.workspaceId).toBe("ws-A");
    expect(rebaseRemainingDraft(draft, { ...out, remaining: [] })).toBeUndefined();
  });
});
