import { describe, it, expect } from "vitest";
import { applyToWindow, buildGenomeTimeline, diffEdits, effectiveAlleles, eventLabel, explainDiff, windowDiff } from "../../src/v12/evolution/genomeModel";
import { linkedHarnessId, policyDiff, recordedReceiptId, sortHarnesses, stepTone, type HarnessRecord } from "../../src/v12/evolution/harnessModel";
import { FakeBackend, FAKE_BASELINE_48 } from "../support/fakeBackend";
import type { Edit, Revision, Workspace } from "../../src/v12/types";

const e = (position: number, ref: string, alt: string): Edit => ({ position, ref, alt, current_allele_at_commit: ref });

/** Drive the fake backend through real propose/commit calls to get authentic revision chains. */
function commit(be: FakeBackend, ws: Workspace, position: number, alt: string): Workspace {
  const p = be.handle("POST", `/api/v10/genome/workspaces/${ws.workspace_id}/proposals`, { position, alt }).json as { proposal_id: string };
  const w = be.ws(ws.workspace_id)!;
  expect(be.handle("POST", `/api/v10/genome/workspaces/${ws.workspace_id}/commit`, { proposal_id: p.proposal_id, expected_counter: w.revision_counter }).status).toBe(200);
  return be.ws(ws.workspace_id)!;
}

describe("Tab 2 genome track: diffs are exact and derived only from stored revisions", () => {
  it("diffEdits reports from->to per position, sorted, reverts to reference drop out", () => {
    expect(diffEdits([], [e(9, "T", "C"), e(4, "T", "A")])).toEqual([{ position: 4, from: "T", to: "A" }, { position: 9, from: "T", to: "C" }]);
    expect(diffEdits([e(4, "T", "A")], [e(4, "T", "C")])).toEqual([{ position: 4, from: "A", to: "C" }]);
    expect(diffEdits([e(4, "T", "A")], [e(4, "T", "A"), e(4, "T", "T")])).toEqual([{ position: 4, from: "A", to: "T" }]);
    expect(diffEdits([e(4, "T", "A")], [e(4, "T", "A")])).toEqual([]);
    expect(diffEdits([], [])).toEqual([]);
  });

  it("later edits at the same position win", () => {
    const m = effectiveAlleles([e(4, "T", "A"), e(4, "T", "G")]);
    expect(m.get(4)).toEqual({ ref: "T", alt: "G" });
  });

  it("window diff marks exactly the changed cells and reports edits outside the window separately", () => {
    const { cells, outside } = windowDiff(FAKE_BASELINE_48, 1, [], [e(4, "T", "A"), e(500, "C", "G")]);
    expect(cells).toHaveLength(48);
    expect(cells.filter((c) => c.changed).map((c) => c.position)).toEqual([4]);
    expect(cells[3]).toMatchObject({ ref: "T", edited: "A", changed: true });
    expect(cells[0]).toMatchObject({ position: 1, changed: false });
    expect(outside).toEqual([{ position: 500, from: "C", to: "G" }]);
  });

  it("applyToWindow equals the backend's recorded preview_1_48 for real revisions (cross-check)", () => {
    const be = new FakeBackend();
    let ws = be.workspaces[0]!;
    ws = commit(be, ws, 4, "A");
    ws = commit(be, ws, 10, "C");
    ws = commit(be, ws, 4, "G");
    for (const r of ws.revisions!) expect(applyToWindow(FAKE_BASELINE_48, 1, r.edits)).toBe(r.preview_1_48);
  });

  it("baseline-only workspace: one anchor, no invented ancestors, polished-empty-state flag", () => {
    const be = new FakeBackend();
    const ws = be.workspaces[0]!;
    const t = buildGenomeTimeline(ws.revisions!, ws.active_genome_revision_id);
    expect(t.baselineOnly).toBe(true);
    expect(t.events.size).toBe(1);
    expect(t.baselineId).toBe(ws.active_genome_revision_id);
    const ev = t.events.get(t.baselineId!)!;
    expect(ev).toMatchObject({ isBaseline: true, isCurrent: true, parentId: null, delta: [] });
    expect(eventLabel(ev)).toBe("Baseline");
    expect(t.branches).toHaveLength(1);
  });

  it("linear history: baseline -> v1 -> v2 with per-step deltas and cumulative diffs vs baseline", () => {
    const be = new FakeBackend();
    let ws = be.workspaces[0]!;
    ws = commit(be, ws, 4, "A");
    ws = commit(be, ws, 10, "C");
    const revs = ws.revisions!;
    expect(revs).toHaveLength(3);
    const t = buildGenomeTimeline(revs, ws.active_genome_revision_id);
    const [r0, r1, r2] = revs.map((r) => t.events.get(r.genome_revision_id)!);
    expect(t.baselineOnly).toBe(false);
    expect(r0!.isBaseline).toBe(true);
    expect(r1!.delta).toEqual([{ position: 4, from: "T", to: "A" }]);
    expect(r2!.delta).toEqual([{ position: 10, from: "G", to: "C" }]);
    expect(r2!.fromBaseline.map((c) => c.position)).toEqual([4, 10]);
    expect(r2!.isCurrent).toBe(true);
    expect(r1!.isCurrent).toBe(false);
    expect(eventLabel(r1!)).toBe("Base 4: T to A");
    expect(t.branches).toHaveLength(1);
    expect(t.branches[0]!.path).toEqual(revs.map((r) => r.genome_revision_id));
  });

  it("branching: two heads give two branches, the one containing the current revision first", () => {
    const mk = (id: string, parent: string | null, edits: Edit[]): Revision => ({ genome_revision_id: id, parent_revision_id: parent, edits, preview_1_48: "", sequence_sha256: "x".repeat(64), harness_version_id: "h", created_at: "2026-01-01T00:00:00+00:00" });
    const revs = [mk("r0", null, []), mk("r1", "r0", [e(4, "T", "A")]), mk("r2", "r0", [e(5, "G", "C")])];
    const t = buildGenomeTimeline(revs, "r2");
    expect(t.branches).toHaveLength(2);
    expect(t.branches[0]!.headId).toBe("r2");
    expect(t.branches[0]!.containsCurrent).toBe(true);
    expect(t.branches[1]!.containsCurrent).toBe(false);
    expect(t.events.get("r1")!.delta).toEqual([{ position: 4, from: "T", to: "A" }]);
    expect(t.events.get("r2")!.delta).toEqual([{ position: 5, from: "G", to: "C" }]);
  });

  it("a cyclic / dangling parent chain cannot hang the builder", () => {
    const mk = (id: string, parent: string | null): Revision => ({ genome_revision_id: id, parent_revision_id: parent, edits: [], preview_1_48: "", sequence_sha256: "", harness_version_id: "h", created_at: "" });
    const t = buildGenomeTimeline([mk("a", "b"), mk("b", "a")], "a");
    expect(t.events.size).toBe(2);
    const t2 = buildGenomeTimeline([mk("a", "ghost")], "a");
    expect(t2.baselineId).toBe("a");
    expect(buildGenomeTimeline([], "x").baselineId).toBeNull();
  });

  it("plain-language explanation states facts only: in-silico, no trait/health claim, singular/plural", () => {
    expect(explainDiff([])).toMatch(/identical to the baseline/);
    const one = explainDiff([{ position: 4, from: "T", to: "A" }]);
    expect(one).toMatch(/1 single-base substitution against the baseline: position 4 \(T to A\)/);
    expect(one).toMatch(/in-silico sequence change/);
    expect(one).toMatch(/not a lab-verified edit/);
    expect(one).toMatch(/no effect on traits or health was computed/);
    const many = explainDiff(Array.from({ length: 9 }, (_, i) => ({ position: i + 1, from: "A", to: "C" })));
    expect(many).toMatch(/9 single-base substitutions/);
    expect(many).toMatch(/and 3 more/);
    for (const t of [one, many]) expect(t.toLowerCase()).not.toMatch(/\b(cure|treat|disease|diagnos|risk|phenotype|healthier|improv)/);
  });
});

describe("Tab 2 harness track is separate from the genome track", () => {
  const h = (version_id: string, status: string, over: Partial<HarnessRecord> = {}): HarnessRecord => ({ version_id, status, ...over });

  it("link only when ids are exactly equal; never inferred", () => {
    const hs = [h("harness-pche-baseline", "BASELINE"), h("harness-v2", "PROMOTED")];
    expect(linkedHarnessId("harness-pche-baseline", hs)).toBe("harness-pche-baseline");
    expect(linkedHarnessId("harness-pche-baselin", hs)).toBeNull();
    expect(linkedHarnessId("HARNESS-V2", hs)).toBeNull();
    expect(linkedHarnessId("harness-pche-baseline", [])).toBeNull();
  });

  it("rejected / failed steps are surfaced as rejected, not hidden or recoloured as success", () => {
    expect(stepTone("BASELINE")).toBe("baseline");
    for (const s of ["REJECTED", "FAILED_VALIDATION", "ERROR", "ABORTED", "DENIED_BY_POLICY"]) expect(stepTone(s), s).toBe("rejected");
    for (const s of ["PROMOTED", "ACCEPTED", "ACTIVE", "PASS"]) expect(stepTone(s), s).toBe("accepted");
    expect(stepTone("CANDIDATE")).toBe("pending");
    expect(stepTone("")).toBe("pending");
  });

  it("policy diff lists exact field changes and tool additions/removals", () => {
    const parent = h("p", "BASELINE", { validation_policy: { strict: true, n: 1 }, allowed_tools: ["a", "b"] });
    const child = h("c", "PROMOTED", { validation_policy: { strict: false, n: 1 }, allowed_tools: ["b", "c"] });
    const d = policyDiff(parent, child);
    expect(d).toContainEqual({ path: "validation_policy.strict", from: "true", to: "false" });
    expect(d).toContainEqual({ path: "allowed_tools", from: "(absent)", to: "+ c" });
    expect(d).toContainEqual({ path: "allowed_tools", from: "a", to: "(removed)" });
    expect(d.some((x) => x.path === "validation_policy.n")).toBe(false);
    expect(policyDiff(undefined, child)).toEqual([]);
  });

  it("sorts by created_at then id; only a RECORDED receipt id is ever returned", () => {
    const sorted = sortHarnesses([h("b", "x", { created_at: "2" }), h("a", "x", { created_at: "2" }), h("z", "x", { created_at: "1" })]);
    expect(sorted.map((x) => x.version_id)).toEqual(["z", "a", "b"]);
    expect(recordedReceiptId(h("a", "x"))).toBeNull();
    expect(recordedReceiptId(h("a", "x", { metadata: { receipt_id: "rcpt-1" } }))).toBe("rcpt-1");
    expect(recordedReceiptId(h("a", "x", { metadata: { receipt_id: 42 } }))).toBeNull();
  });
});
