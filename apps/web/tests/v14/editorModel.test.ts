import { describe, it, expect } from "vitest";
import {
  GRCH38_REFERENCE_ASSET_ID,
  SYNTHETIC_REFERENCE_ASSET_ID,
  applyDraftOps,
  applySavedEdits,
} from "../../src/v12/editor/editorModel";
import { FAKE_BASELINE_48 } from "../support/fakeBackend";
import { routePrompt } from "../../src/v12/editor/promptRouter";

const B = FAKE_BASELINE_48;

describe("applySavedEdits filters by reference_asset_id", () => {
  it("ignores GRCh38-tagged edits when applying the synthetic window", () => {
    const out = applySavedEdits(B, 1, [
      { position: 4, alt: "A", reference_asset_id: GRCH38_REFERENCE_ASSET_ID },
      { position: 10, alt: "C" },
    ]);
    expect(out[3]).toBe(B[3]);
    expect(out[9]).toBe("C");
  });

  it("ignores synthetic / untagged edits when applying a GRCh38 window", () => {
    const out = applySavedEdits(B, 1, [
      { position: 4, alt: "A" },
      { position: 10, alt: "C", reference_asset_id: GRCH38_REFERENCE_ASSET_ID },
      { position: 12, alt: "T", reference_asset_id: "other_ref" },
    ], GRCH38_REFERENCE_ASSET_ID);
    expect(out[3]).toBe(B[3]);
    expect(out[9]).toBe("C");
    expect(out[11]).toBe(B[11]);
  });

  it("ignores unknown extra fields and still applies a matching synthetic edit", () => {
    const extra = { position: 4, alt: "A", locus_id: "grch38:x", assembly: "GRCh38", contig: "14", gene_id: "ENSG1" };
    const out = applySavedEdits(B, 1, [extra]);
    expect(out[3]).toBe("A");
  });

  it("default reference is synthetic chr22", () => {
    expect(SYNTHETIC_REFERENCE_ASSET_ID).toBe("ref_synthetic_chr22");
    expect(applySavedEdits(B, 1, [{ position: 4, alt: "A" }])[3]).toBe("A");
  });
});

describe("reduced motion still allows an edit", () => {
  it("applyDraftOps has no motion gate (draft still paints)", () => {
    const reducedMotion = true;
    const out = applyDraftOps(B, 1, [{ position: 4, alt: "A" }]);
    expect(reducedMotion).toBe(true);
    expect(out[3]).toBe("A");
    expect(B[3]).not.toBe("A");
  });

  it("the router still returns PRECISE_EDIT when the caller is in reduced motion", () => {
    const r = routePrompt("change base 4 to A", {
      selectedPosition: null,
      windowStart: 1,
      windowEnd: 48,
      contig: "chr22",
    });
    expect(r.intent).toBe("PRECISE_EDIT");
    expect(r.edit?.position).toBe(4);
    expect(r.edit?.alt).toBe("A");
  });
});
