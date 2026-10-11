import { describe, expect, it } from "vitest";
import { applyToWindow, buildGenomeTimeline, diffEdits, nodesFromLineage, nodesFromRevisions, nodesFromWorkspaces, windowDiff } from "./genomeModel";
import type { Edit, Revision } from "../types";

const e = (position: number, ref: string, alt: string): Edit => ({ position, ref, alt, current_allele_at_commit: ref });
const rev = (id: string, parent: string | null, edits: Edit[]): Revision => ({ genome_revision_id: id, parent_revision_id: parent, edits, preview_1_48: "", sequence_sha256: id + "-sha", harness_version_id: "h", created_at: "t" });

describe("genome diff", () => {
  it("diffs cumulative edit lists and drops reverts", () => {
    expect(diffEdits([], [e(5, "G", "T")])).toEqual([{ position: 5, from: "G", to: "T" }]);
    expect(diffEdits([], [e(5, "G", "T"), e(5, "T", "G")])).toEqual([]);
    expect(diffEdits([e(5, "G", "T")], [e(5, "G", "T"), e(5, "T", "G")])).toEqual([{ position: 5, from: "T", to: "G" }]);
    expect(diffEdits([e(5, "G", "T")], [e(5, "G", "A")])).toEqual([{ position: 5, from: "T", to: "A" }]);
  });
  it("windowed diff marks only changed bases and reports outside edits", () => {
    const { cells, outside } = windowDiff("ACGTA", 1, [], [e(3, "G", "T"), e(99, "A", "C")]);
    expect(cells.map((c) => c.edited).join("")).toBe("ACTTA");
    expect(cells.filter((c) => c.changed).map((c) => c.position)).toEqual([3]);
    expect(outside).toEqual([{ position: 99, from: "A", to: "C" }]);
    expect(applyToWindow("ACGTA", 1, [e(3, "G", "T")])).toBe("ACTTA");
  });
});

describe("timeline", () => {
  it("linear history has one branch with baseline anchor and current marked", () => {
    const t = buildGenomeTimeline(nodesFromRevisions([rev("r0", null, []), rev("r1", "r0", [e(5, "G", "T")]), rev("r2", "r1", [e(5, "G", "T"), e(12, "A", "G")])]), "r2");
    expect(t.baselineOnly).toBe(false);
    expect(t.branches).toHaveLength(1);
    expect(t.branches[0].path).toEqual(["r0", "r1", "r2"]);
    expect(t.events.get("r0")!.isBaseline).toBe(true);
    expect(t.events.get("r2")!.isCurrent).toBe(true);
    expect(t.events.get("r2")!.delta).toEqual([{ position: 12, from: "A", to: "G" }]);
    expect(t.events.get("r2")!.fromBaseline).toHaveLength(2);
  });
  it("baseline-only has no invented ancestors", () => {
    const t = buildGenomeTimeline(nodesFromRevisions([rev("r0", null, [])]), "r0");
    expect(t.baselineOnly).toBe(true);
    expect(t.events.size).toBe(1);
  });
  it("branches are detected from shared parents", () => {
    const t = buildGenomeTimeline(nodesFromRevisions([rev("r0", null, []), rev("r1", "r0", [e(1, "A", "C")]), rev("r2", "r0", [e(2, "C", "G")])]), "r2");
    expect(t.branches).toHaveLength(2);
    expect(t.branches[0].headId).toBe("r2");
  });
  it("lineage nodes: ancestor edits are derived from the active revision's ordered list", () => {
    const active = rev("r2", "r1", [e(5, "G", "T"), e(12, "A", "G")]);
    const t = buildGenomeTimeline(
      nodesFromLineage(
        [
          { genome_revision_id: "r0", parent_revision_id: null, edit_count: 0, sequence_sha256: "a" },
          { genome_revision_id: "r1", parent_revision_id: "r0", edit_count: 1, sequence_sha256: "b" },
          { genome_revision_id: "r2", parent_revision_id: "r1", edit_count: 2, sequence_sha256: "c" },
        ],
        active,
      ),
      "r2",
    );
    expect(t.events.get("r1")!.node.editsSource).toBe("derived");
    expect(t.events.get("r1")!.delta).toEqual([{ position: 5, from: "G", to: "T" }]);
    expect(t.events.get("r2")!.delta).toEqual([{ position: 12, from: "A", to: "G" }]);
  });
  it("a branched workspace gets a virtual reference anchor, not an invented revision", () => {
    const active = rev("c1", "other-ws-rev", [e(5, "G", "T")]);
    const t = buildGenomeTimeline(nodesFromRevisions([active]), "c1");
    expect(t.virtualBaseline).toBe(true);
    expect(t.baselineOnly).toBe(false);
    expect(t.events.get("__reference__")!.node.virtual).toBe(true);
    expect(t.events.get("c1")!.fromBaseline).toEqual([{ position: 5, from: "G", to: "T" }]);
  });
  it("joins a branch stored in another workspace only through its recorded parent id", () => {
    const ln = (id: string, parent: string | null, n: number) => ({ genome_revision_id: id, parent_revision_id: parent, edit_count: n, sequence_sha256: id });
    const src = { workspaceId: "wsA", name: "Study", nodes: [ln("a0", null, 0), ln("a1", "a0", 1)], active: rev("a1", "a0", [e(4, "T", "A")]) };
    const br = { workspaceId: "wsB", name: "Study / B", nodes: [ln("b0", "a1", 1), ln("b1", "b0", 2)], active: rev("b1", "b0", [e(4, "T", "A"), e(25, "A", "T")]) };
    const unrelated = { workspaceId: "wsC", name: "Other", nodes: [ln("c0", null, 0)], active: rev("c0", null, []) };
    for (const [cur, head] of [["wsA", "a1"], ["wsB", "b1"]] as const) {
      const t = buildGenomeTimeline(nodesFromWorkspaces(cur, [src, br, unrelated]), head);
      expect([...t.events.keys()].sort()).toEqual(["a0", "a1", "b0", "b1"]);
      expect(t.baselineId).toBe("a0");
      expect(t.events.get("b0")!.isBranchPoint).toBe(true);
      expect(t.events.get("b0")!.delta).toEqual([]);
      expect(t.events.get("b1")!.delta).toEqual([{ position: 25, from: "A", to: "T" }]);
      expect(t.events.get("b1")!.node.workspaceName).toBe("Study / B");
    }
    expect(nodesFromWorkspaces("wsC", [src, br, unrelated]).map((n) => n.id)).toEqual(["c0"]);
  });
});
