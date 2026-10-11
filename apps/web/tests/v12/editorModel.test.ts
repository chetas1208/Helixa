import { describe, it, expect } from "vitest";
import {
  applyDraftOps, applySavedEdits, baseAtPosition, complementOf, deriveEditorStatus, describeSelection, detectDraftConflict,
  diffPositions, draftSummary, indexOfPosition, isNucleotide, pairBondCount, refreshOps, restoreBaselineOps, savedBasesOf, substitutionClass,
} from "../../src/v12/editor/editorModel";
import { FAKE_BASELINE_48 } from "../support/fakeBackend";
import type { DraftOp } from "../../src/v12/types";

const B = FAKE_BASELINE_48; // real first 48 bases of the synthetic chr22 window

describe("base selection -> coordinate + complement mapping", () => {
  it("maps 1-based coordinates to window indices and back, rejecting anything outside", () => {
    expect(indexOfPosition(1, 1, 48)).toBe(0);
    expect(indexOfPosition(48, 1, 48)).toBe(47);
    expect(indexOfPosition(0, 1, 48)).toBe(-1);
    expect(indexOfPosition(49, 1, 48)).toBe(-1);
    expect(indexOfPosition(1.5, 1, 48)).toBe(-1);
    expect(indexOfPosition(120, 100, 48)).toBe(20);
    expect(indexOfPosition(99, 100, 48)).toBe(-1);
  });

  it("complement is Watson-Crick (A-T, C-G) and never invents a letter", () => {
    expect([complementOf("A"), complementOf("T"), complementOf("C"), complementOf("G")]).toEqual(["T", "A", "G", "C"]);
    expect(complementOf("a")).toBe("T");
    for (const bad of ["N", "U", "", " ", "AA", "x", null, undefined]) expect(complementOf(bad as never)).toBeNull();
    for (const n of ["A", "C", "G", "T"]) expect(complementOf(complementOf(n)!)).toBe(n);
  });

  it("pair bond counts: A-T=2, C-G=3 (shape cue, not colour)", () => {
    expect([pairBondCount("A"), pairBondCount("T"), pairBondCount("C"), pairBondCount("G"), pairBondCount("N")]).toEqual([2, 2, 3, 3, null]);
  });

  it("selecting position 4 of the real baseline gives T with complement A at coordinate 4", () => {
    const info = describeSelection(4, 1, B, B, B, [])!;
    expect(info.position).toBe(4);
    expect(info.index).toBe(3);
    expect(info.reference).toBe("T");
    expect(info.complementOfReference).toBe("A");
    expect(info.proposedAlt).toBeNull();
    expect(info.changedInDraft).toBe(false);
    expect(info.changedInSaved).toBe(false);
  });

  it("every one of the 48 positions maps to its own base and the correct complement", () => {
    for (let p = 1; p <= 48; p++) {
      const info = describeSelection(p, 1, B, B, B, [])!;
      expect(info.reference).toBe(B[p - 1]);
      expect(info.complementOfReference).toBe(complementOf(B[p - 1]));
      expect(baseAtPosition(B, 1, p)).toBe(B[p - 1]);
    }
    expect(describeSelection(49, 1, B, B, B, [])).toBeNull();
    expect(describeSelection(0, 1, B, B, B, [])).toBeNull();
  });

  it("a draft alt is reported as proposed, complement of the draft updates, saved stays untouched", () => {
    const op: DraftOp = { position: 4, ref: "T", alt: "A", origin: "manual" };
    const draft = applyDraftOps(B, 1, [op]);
    const info = describeSelection(4, 1, B, B, draft, [op])!;
    expect(info.proposedAlt).toBe("A");
    expect(info.draft).toBe("A");
    expect(info.saved).toBe("T");
    expect(info.complementOfDraft).toBe("T");
    expect(info.changedInDraft).toBe(true);
    expect(info.changedInSaved).toBe(false);
  });

  it("isNucleotide is strict (case-sensitive A/C/G/T only)", () => {
    expect(["A", "C", "G", "T"].every(isNucleotide)).toBe(true);
    for (const bad of ["a", "N", "U", "", "AA", 1, null]) expect(isNucleotide(bad)).toBe(false);
  });
});

describe("drafts vs saved state", () => {
  it("applying a draft never mutates the saved string (draft only until confirm)", () => {
    const saved = B;
    const out = applyDraftOps(saved, 1, [{ position: 4, alt: "A" }, { position: 10, alt: "C" }]);
    expect(saved).toBe(B);
    expect(out).not.toBe(saved);
    expect(diffPositions(saved, out, 1)).toEqual([4, 10]);
  });
  it("ignores out-of-window and invalid alts", () => {
    expect(applySavedEdits(B, 1, [{ position: 99, alt: "A" }, { position: 0, alt: "A" }, { position: 4, alt: "Z" }])).toBe(B);
  });
  it("later ops on the same position win", () => {
    expect(applyDraftOps(B, 1, [{ position: 4, alt: "A" }, { position: 4, alt: "C" }])[3]).toBe("C");
  });
  it("diffPositions gives 1-based coordinates in the window frame", () => {
    expect(diffPositions("ACGT", "AGGA", 100)).toEqual([101, 103]);
  });
  it("savedBasesOf applies the revision edits to the baseline", () => {
    expect(savedBasesOf(B, 1, { edits: [{ position: 4, ref: "T", alt: "A", current_allele_at_commit: "T" }] })[3]).toBe("A");
    expect(savedBasesOf(B, 1, undefined)).toBe(B);
  });
  it("refreshOps re-reads ref after a remote change and drops ops that became no-ops", () => {
    const ops: DraftOp[] = [
      { position: 4, ref: "T", alt: "A", origin: "manual" },
      { position: 5, ref: "G", alt: "C", origin: "manual" },
    ];
    const remote = applySavedEdits(B, 1, [{ position: 4, alt: "A" }]); // someone else already set 4 -> A
    const out = refreshOps(ops, remote, 1);
    expect(out.map((o) => o.position)).toEqual([5]);
    expect(out[0]!.ref).toBe(B[4]);
  });
});

describe("restore baseline never destroys saved versions", () => {
  it("produces draft ops (a new version once confirmed) and leaves the inputs untouched", () => {
    const saved = applySavedEdits(B, 1, [{ position: 4, alt: "A" }, { position: 10, alt: "A" }]);
    const savedCopy = saved;
    const ops = restoreBaselineOps(saved, B, 1);
    expect(ops.map((o) => [o.position, o.ref, o.alt])).toEqual([
      [4, "A", "T"],
      [10, "A", B[9]],
    ]);
    expect(saved).toBe(savedCopy);
    // applying the ops reproduces the baseline sequence exactly
    expect(applyDraftOps(saved, 1, ops)).toBe(B);
  });
  it("is a no-op when saved already equals the baseline", () => {
    expect(restoreBaselineOps(B, B, 1)).toEqual([]);
  });
});

describe("draft conflict detection (remote revision changed)", () => {
  const ws = { revision_counter: 3, active_genome_revision_id: "rev-3" };
  it("same base -> none", () => {
    expect(detectDraftConflict({ baseCounter: 3, baseRevisionId: "rev-3", ops: [{ position: 1, ref: "A", alt: "C", origin: "manual" }] }, ws)).toEqual({ kind: "none" });
  });
  it("different counter with ops -> remote-change; with no ops -> silent rebase", () => {
    const op: DraftOp = { position: 1, ref: "A", alt: "C", origin: "manual" };
    expect(detectDraftConflict({ baseCounter: 2, baseRevisionId: "rev-2", ops: [op] }, ws).kind).toBe("remote-change");
    expect(detectDraftConflict({ baseCounter: 2, baseRevisionId: "rev-2", ops: [] }, ws).kind).toBe("stale-empty");
  });
  it("same counter but different revision id is still a conflict (branch swap)", () => {
    const op: DraftOp = { position: 1, ref: "A", alt: "C", origin: "manual" };
    expect(detectDraftConflict({ baseCounter: 3, baseRevisionId: "rev-OTHER", ops: [op] }, ws).kind).toBe("remote-change");
  });
  it("missing draft or workspace -> none", () => {
    expect(detectDraftConflict(undefined, ws).kind).toBe("none");
    expect(detectDraftConflict({ baseCounter: 1, baseRevisionId: "x", ops: [] }, undefined).kind).toBe("none");
  });
});

describe("status chip derivation and science wording", () => {
  const base = { editCount: 0, draftOpCount: 0, validating: false, unsupported: false };
  it("priority pending > unsupported > draft > validated > baseline", () => {
    expect(deriveEditorStatus(base)).toBe("Baseline");
    expect(deriveEditorStatus({ ...base, editCount: 1 })).toBe("Validated");
    expect(deriveEditorStatus({ ...base, editCount: 1, draftOpCount: 2 })).toBe("Draft");
    expect(deriveEditorStatus({ ...base, draftOpCount: 1, unsupported: true })).toBe("Unsupported");
    expect(deriveEditorStatus({ ...base, draftOpCount: 1, unsupported: true, validating: true })).toBe("Analysis pending");
  });
  it("substitution class is sequence-level only", () => {
    expect(substitutionClass("A", "G")).toBe("transition");
    expect(substitutionClass("C", "T")).toBe("transition");
    expect(substitutionClass("A", "C")).toBe("transversion");
    expect(substitutionClass("A", "A")).toBe("none");
    expect(substitutionClass("N", "A")).toBe("none");
  });
  it("draft summary wording", () => {
    expect(draftSummary([])).toBe("No unsaved changes");
    expect(draftSummary([{ position: 4, ref: "T", alt: "A", origin: "manual" }])).toMatch(/1 unsaved base change/);
  });
});
