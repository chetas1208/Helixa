import { describe, it, expect } from "vitest";
import { canRedo, canUndo, draftReducer, emptyDraft, hasOps, opAt } from "../../src/v12/editor/draftReducer";
import type { DraftOp, EditDraft } from "../../src/v12/types";

const ws = { workspace_id: "ws-1", active_genome_revision_id: "rev-1", revision_counter: 1 };
const op = (position: number, ref: string, alt: string, origin: DraftOp["origin"] = "manual") => ({ position, ref, alt: alt as DraftOp["alt"], origin });
const add = (d: EditDraft, o: DraftOp) => draftReducer(d, { type: "add", op: o });

describe("draftReducer", () => {
  it("emptyDraft records workspace, base revision and the expected_counter source", () => {
    const d = emptyDraft(ws);
    expect(d).toEqual({ workspaceId: "ws-1", baseRevisionId: "rev-1", baseCounter: 1, ops: [], redo: [] });
    expect(hasOps(d)).toBe(false);
  });

  it("add appends a pending op; a manual edit is only a draft (no commit capability in the reducer)", () => {
    const d = add(emptyDraft(ws), op(4, "T", "A"));
    expect(d.ops).toEqual([op(4, "T", "A")]);
    expect(hasOps(d)).toBe(true);
    expect(opAt(d, 4)?.alt).toBe("A");
    expect(opAt(d, 5)).toBeUndefined();
  });

  it("one op per position: a newer op replaces and is ordered last", () => {
    let d = emptyDraft(ws);
    d = add(d, op(4, "T", "A"));
    d = add(d, op(9, "T", "C"));
    d = add(d, op(4, "T", "G"));
    expect(d.ops.map((o) => [o.position, o.alt])).toEqual([[9, "C"], [4, "G"]]);
  });

  it("adding alt == ref reverts that position (removes the op, adds nothing)", () => {
    let d = add(emptyDraft(ws), op(4, "T", "A"));
    d = add(d, op(4, "T", "T"));
    expect(d.ops).toEqual([]);
  });

  it("alt == ref with no existing op returns the SAME object", () => {
    const d = emptyDraft(ws);
    expect(add(d, op(4, "T", "T"))).toBe(d);
  });

  it("ignores invalid ops (bad alt, position 0/negative/fractional/NaN) by returning the same object", () => {
    const d = emptyDraft(ws);
    for (const bad of [op(4, "T", "Z"), op(4, "T", "a"), op(0, "T", "A"), op(-1, "T", "A"), op(1.5, "T", "A"), op(NaN, "T", "A"), op(4, "T", "")]) {
      expect(add(d, bad as DraftOp)).toBe(d);
    }
  });

  it("undo / redo are inverse; add clears the redo stack", () => {
    let d = add(add(emptyDraft(ws), op(4, "T", "A")), op(9, "T", "C"));
    d = draftReducer(d, { type: "undo" });
    expect(d.ops.map((o) => o.position)).toEqual([4]);
    expect(canRedo(d)).toBe(true);
    d = draftReducer(d, { type: "redo" });
    expect(d.ops.map((o) => o.position)).toEqual([4, 9]);
    expect(canRedo(d)).toBe(false);
    d = draftReducer(d, { type: "undo" });
    d = add(d, op(12, "T", "G"));
    expect(canRedo(d)).toBe(false);
    expect(d.redo).toEqual([]);
  });

  it("undo/redo on empty stacks are no-ops returning the same object; flags match", () => {
    const d = emptyDraft(ws);
    expect(draftReducer(d, { type: "undo" })).toBe(d);
    expect(draftReducer(d, { type: "redo" })).toBe(d);
    expect(canUndo(d)).toBe(false);
    expect(canUndo(undefined)).toBe(false);
    expect(canRedo(undefined)).toBe(false);
  });

  it("clear drops ops and redo but keeps the base (Discard); no-op when already empty", () => {
    let d = add(emptyDraft(ws), op(4, "T", "A"));
    d = draftReducer(d, { type: "undo" });
    d = add(d, op(5, "G", "C"));
    const cleared = draftReducer(d, { type: "clear" });
    expect(cleared).toMatchObject({ ops: [], redo: [], baseRevisionId: "rev-1", baseCounter: 1, workspaceId: "ws-1" });
    const e = emptyDraft(ws);
    expect(draftReducer(e, { type: "clear" })).toBe(e);
  });

  it("rebase moves only the recorded base and leaves ops untouched", () => {
    const d = add(emptyDraft(ws), op(4, "T", "A"));
    const r = draftReducer(d, { type: "rebase", baseRevisionId: "rev-2", baseCounter: 2 });
    expect(r.baseRevisionId).toBe("rev-2");
    expect(r.baseCounter).toBe(2);
    expect(r.ops).toEqual(d.ops);
    expect(draftReducer(d, { type: "rebase", baseRevisionId: "rev-1", baseCounter: 1 })).toBe(d);
  });

  it("is pure: never mutates its input", () => {
    const d = Object.freeze({ ...emptyDraft(ws), ops: Object.freeze([op(4, "T", "A")]) as unknown as DraftOp[] }) as EditDraft;
    expect(() => draftReducer(d, { type: "undo" })).not.toThrow();
    expect(() => add(d, op(9, "T", "C"))).not.toThrow();
    expect(d.ops).toHaveLength(1);
  });

  it("unknown action returns the same draft", () => {
    const d = emptyDraft(ws);
    expect(draftReducer(d, { type: "bogus" } as never)).toBe(d);
  });
});
