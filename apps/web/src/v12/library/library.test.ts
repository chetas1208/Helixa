import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { DraftOp, EditDraft, Proposal, Revision, Workspace } from "../types";
import { mergeRunIds, buildBranchPath, buildProvenanceExport, checkEdits, compareWorkspaces, describeBaseline, filterAndSortWorkspaces, workspaceEvidence } from "./libraryModel";
import { validateWorkspaceName } from "./NameDialog";
import { rebaseRemainingDraft, saveDraftSequentially } from "./switchFlow";
import type { SaveDeps } from "./switchFlow";

const rev = (id: string, parent: string | null, edits: Revision["edits"] = [], sha = "s"): Revision => ({
  genome_revision_id: id, parent_revision_id: parent, edits, preview_1_48: "ACGT", sequence_sha256: sha, harness_version_id: "h", created_at: "2026-01-01T00:00:00Z",
});
const mk = (id: string, name: string, r: Revision, extra: Partial<Workspace> = {}): Workspace => ({
  workspace_id: id, name, reference_asset_id: "ref", assembly: "syn", official_grch38: false, active_genome_revision_id: r.genome_revision_id,
  active_harness_version_id: "harness-x", revision_counter: 1, edit_count: r.edits.length, active_revision: r, status: "ACTIVE", updated_at: "2026-01-01T00:00:00Z", ...extra,
});
const edit = (position: number, ref: string, alt: string, cur = ref) => ({ position, ref, alt, current_allele_at_commit: cur });

describe("filter/sort", () => {
  const a = mk("ws-a", "Alpha", rev("rev-a", null), { updated_at: "2026-01-02T00:00:00Z" });
  const b = mk("ws-b", "beta", rev("rev-b", null, [edit(3, "G", "A")]), { updated_at: "2026-01-03T00:00:00Z" });
  const c = mk("ws-c", "Gamma", rev("rev-c", null, [edit(3, "G", "A"), edit(5, "T", "C")]), { updated_at: "2026-01-01T00:00:00Z" });
  it("sorts", () => {
    const ids = (s: "updated" | "name" | "edits") => filterAndSortWorkspaces([a, b, c], { query: "", filter: "all", sort: s }).map((w) => w.workspace_id);
    expect(ids("updated")).toEqual(["ws-b", "ws-a", "ws-c"]);
    expect(ids("name")).toEqual(["ws-a", "ws-b", "ws-c"]);
    expect(ids("edits")).toEqual(["ws-c", "ws-b", "ws-a"]);
  });
  it("filters and searches", () => {
    expect(filterAndSortWorkspaces([a, b, c], { query: "", filter: "baseline-only", sort: "name" }).map((w) => w.name)).toEqual(["Alpha"]);
    expect(filterAndSortWorkspaces([a, b, c], { query: "REV-C", filter: "all", sort: "name" }).map((w) => w.name)).toEqual(["Gamma"]);
    expect(filterAndSortWorkspaces([a, b, c], { query: "zzz", filter: "all", sort: "name" })).toEqual([]);
  });
});

describe("evidence + edit checks", () => {
  it("baseline is REFERENCE; edits are HYPOTHESIS; repeat edit at one position is consistent", () => {
    expect(workspaceEvidence(mk("ws-a", "a", rev("r", null))).kind).toBe("REFERENCE");
    expect(workspaceEvidence(mk("ws-a", "a", rev("r", null, [edit(3, "G", "A")]))).kind).toBe("HYPOTHESIS");
    const again = [edit(3, "G", "A"), edit(3, "G", "C", "A")];
    expect(checkEdits(again).every((c) => c.matched)).toBe(true);
    expect(workspaceEvidence(mk("ws-a", "a", rev("r", null, again))).kind).toBe("HYPOTHESIS");
    expect(workspaceEvidence(mk("ws-a", "a", rev("r", null, [edit(3, "G", "A", "T")]))).kind).toBe("INCONCLUSIVE");
  });
});

describe("branch path / baseline", () => {
  const root = mk("ws-a", "A", rev("rev-a0", null));
  const child = mk("ws-b", "B", rev("rev-b0", "rev-a0"));
  it("walks across workspaces to the immutable baseline", () => {
    const p = buildBranchPath(child, [root, child]);
    expect(p.steps.map((s) => s.revisionId)).toEqual(["rev-b0", "rev-a0"]);
    expect(p.root?.revisionId).toBe("rev-a0");
    expect(describeBaseline(p).known).toBe(true);
  });
  it("reports truncation instead of inventing ancestors, and survives cycles", () => {
    const p = buildBranchPath(child, [child]);
    expect(p.truncatedAt).toBe("rev-a0");
    expect(describeBaseline(p).known).toBe(false);
    const cyc = mk("ws-c", "C", rev("rev-x", "rev-y"));
    const cyc2 = mk("ws-d", "D", rev("rev-y", "rev-x"));
    expect(buildBranchPath(cyc, [cyc, cyc2]).steps).toHaveLength(2);
  });
});

describe("compare + export", () => {
  const a = mk("ws-a", "A", rev("rev-a", null, [edit(3, "G", "A"), edit(7, "C", "T")], "h1"));
  const b = mk("ws-b", "B", rev("rev-b", null, [edit(3, "G", "C"), edit(9, "A", "G")], "h2"));
  it("diffs effective edits", () => {
    const c = compareWorkspaces(a, b);
    expect(c.rows.map((r) => [r.position, r.status])).toEqual([[3, "differs"], [7, "only-a"], [9, "only-b"]]);
    expect(c.sameSequence).toBe(false);
  });
  it("provenance export holds ids/hashes/edits only", () => {
    const j = JSON.stringify(buildProvenanceExport(a, [a, b], [], new Date("2026-02-02T00:00:00Z")));
    expect(j).toContain("rev-a");
    expect(j).toContain("h1");
    expect(j).not.toContain("preview_1_48");
    expect(j).not.toContain("transcript");
  });
});

describe("workspace name", () => {
  it("validates", () => {
    expect(validateWorkspaceName("  x ")).toEqual({ ok: true, name: "x" });
    expect(validateWorkspaceName("  ").ok).toBe(false);
    expect(validateWorkspaceName("a".repeat(81)).ok).toBe(false);
  });
});

describe("draft save sequence", () => {
  const op = (position: number): DraftOp => ({ position, ref: "A", alt: "C", origin: "manual" });
  const draft: EditDraft = { workspaceId: "ws-a", baseRevisionId: "rev-0", baseCounter: 4, ops: [op(1), op(2), op(3)], redo: [] };
  const prop = (ws: string, o: DraftOp): Proposal => ({ proposal_id: `p${o.position}`, workspace_id: ws, assembly: "", contig: "", position: o.position, ref: "A", current_allele: "A", alt: "C", note: "", status: "READY", reason: "", applied: false });

  it("uses the draft's counter first, then each returned counter, only for the draft's workspace", async () => {
    const calls: [string, number][] = [];
    const deps: SaveDeps = {
      propose: async (ws, o) => prop(ws, o),
      commit: async (ws, _p, counter) => { calls.push([ws, counter]); return { workspace_id: ws, revision_counter: counter + 1, active_genome_revision_id: `rev-${counter + 1}` }; },
      shouldStop: () => false,
    };
    const out = await saveDraftSequentially(draft, deps);
    expect(calls).toEqual([["ws-a", 4], ["ws-a", 5], ["ws-a", 6]]);
    expect(out).toMatchObject({ saved: 3, failure: null, counter: 7 });
    expect(rebaseRemainingDraft(draft, out)).toBeUndefined();
  });
  it("stops at the first 409 and keeps the rest as a rebased draft", async () => {
    let n = 0;
    const deps: SaveDeps = {
      propose: async (ws, o) => prop(ws, o),
      commit: async (ws, _p, counter) => {
        if (++n === 2) throw new ApiError(409, "revision_counter is 9, not 5", "/commit");
        return { workspace_id: ws, revision_counter: counter + 1, active_genome_revision_id: `rev-${counter + 1}` };
      },
      shouldStop: () => false,
    };
    const out = await saveDraftSequentially(draft, deps);
    expect(out.saved).toBe(1);
    expect(out.failure).toMatchObject({ kind: "conflict", message: "revision_counter is 9, not 5" });
    expect(n).toBe(2);
    const rest = rebaseRemainingDraft(draft, out);
    expect(rest?.ops.map((o) => o.position)).toEqual([2, 3]);
    expect(rest?.baseCounter).toBe(5);
    expect(rest?.workspaceId).toBe("ws-a");
  });
  it("treats a REJECTED proposal as a failure and honours stop", async () => {
    const rejected = await saveDraftSequentially(draft, {
      propose: async (ws, o) => ({ ...prop(ws, o), status: "REJECTED", reason: "ref mismatch" }),
      commit: async () => { throw new Error("must not commit"); },
      shouldStop: () => false,
    });
    expect(rejected.failure).toMatchObject({ kind: "rejected", message: "ref mismatch" });
    const stopped = await saveDraftSequentially(draft, { propose: async (ws, o) => prop(ws, o), commit: async () => { throw new Error("no"); }, shouldStop: () => true });
    expect(stopped.failure?.kind).toBe("stopped");
    expect(stopped.saved).toBe(0);
  });
});

describe("archived + run ids", () => {
  it("hides archived workspaces unless asked", () => {
    const a = mk("ws-a", "A", rev("rev-a", null));
    const z = mk("ws-z", "Z", rev("rev-z", null), { status: "ARCHIVED" });
    expect(filterAndSortWorkspaces([a, z], { query: "", filter: "all", sort: "name" }).map((w) => w.name)).toEqual(["A"]);
    expect(filterAndSortWorkspaces([a, z], { query: "", filter: "all", sort: "name", includeArchived: true })).toHaveLength(2);
  });
  it("merges server (oldest first) and remembered (newest first) newest first without duplicates", () => {
    expect(mergeRunIds(["sim-1", "sim-2"], ["sim-3", "sim-2"])).toEqual(["sim-2", "sim-1", "sim-3"]);
    expect(mergeRunIds([], [])).toEqual([]);
  });
});
