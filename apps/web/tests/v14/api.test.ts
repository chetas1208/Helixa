import { describe, expect, it } from "vitest";
import { ApplyEditResultSchema, GenomeEditProposalSchema, InterpretCommandResponseSchema, VoiceStatusSchema, v14qk } from "../../src/v14/api/schemas";
import { V14 } from "../../src/v14/api/client";
import { isAnatomyId, isGeneId, isLocusId, parseAnatomyUrl, serialiseAnatomyUrl } from "../../src/v14/state/urlParams";

const interpretOk = {
  intent: "TRAIT_GOAL" as const,
  explore: null,
  edit: null,
  trait_goal: {
    topic: "eye colour",
    why_not_automatic: "polygenic",
    related_anatomy_ids: [],
    explore_actions: ["show_genes"],
    complexity_notes: ["many loci"],
  },
  reason: "polygenic",
  parser: "deterministic-v14",
  source: "text" as const,
};

const proposalOk = {
  proposal_id: "gep-aaa",
  workspace_id: "ws-bbb",
  parent_revision_id: "rev-ccc",
  reference_asset_id: "ref_synthetic_chr22",
  locus_id: null,
  assembly: "synthetic-chr22-educational",
  contig: "chr22",
  position: 6,
  reference_allele: "G",
  current_allele: "G",
  alternate_allele: "A",
  normalized_representation: "chr22-6-G-A (synthetic-chr22-educational, VCF-style)",
  validation_status: "pending" as const,
  checks: [],
  consequence_status: "not-computed" as const,
  consequence: null,
  overlapping_features: [],
  evidence_refs: [],
  source: "text" as const,
  anatomy_id: null,
  created_at: "2026-10-11T00:00:00+00:00",
};

describe("V14 interpret / proposal schemas", () => {
  it("accepts a trait goal and never requires an edit object", () => {
    const parsed = InterpretCommandResponseSchema.safeParse(interpretOk);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.intent).toBe("TRAIT_GOAL");
      expect(parsed.data.edit ?? null).toBeNull();
    }
  });

  it("rejects a missing intent", () => {
    expect(InterpretCommandResponseSchema.safeParse({ ...interpretOk, intent: "EDIT" }).success).toBe(false);
  });

  it("accepts a pending proposal and a valid apply receipt", () => {
    expect(GenomeEditProposalSchema.safeParse(proposalOk).success).toBe(true);
    expect(
      ApplyEditResultSchema.safeParse({
        workspace: {
          workspace_id: "ws-bbb",
          revision_counter: 2,
          active_genome_revision_id: "rev-ddd",
          active_harness_version_id: "harness-pche-baseline",
          edit_count: 1,
        },
        revision: {
          genome_revision_id: "rev-ddd",
          parent_revision_id: "rev-ccc",
          edits: [{ position: 6, ref: "G", alt: "A", current_allele_at_commit: "G", reference_asset_id: "ref_synthetic_chr22" }],
          preview_1_48: "A".repeat(48),
          sequence_sha256: "abc",
          harness_version_id: "harness-pche-baseline",
          created_at: "t",
        },
        receipt: { proposal_id: "gep-aaa", workspace_id: "ws-bbb", genome_revision_id: "rev-ddd", applied_at: "t" },
      }).success,
    ).toBe(true);
  });

  it("voice status never treats Connected as a legal stt value", () => {
    expect(VoiceStatusSchema.safeParse({ stt: "NOT_CONFIGURED", provider: null, verified_at: null }).success).toBe(true);
    expect(VoiceStatusSchema.safeParse({ stt: "Connected", provider: "elevenlabs" }).success).toBe(false);
    expect(VoiceStatusSchema.safeParse({ stt: "VERIFIED", provider: "whisper", verified_at: "2026-10-11T00:00:00Z" }).success).toBe(true);
  });
});

describe("V14 query keys include workspace / anatomy / gene / locus ids", () => {
  it("scopes interpret, proposal, loci and window keys", () => {
    expect(v14qk.interpret("ws-1", "UBERON:0000948", "ENSG00000092054", "grch38:MYH7:14:1-2")).toEqual([
      "v14",
      "interpret",
      "ws-1",
      "UBERON:0000948",
      "ENSG00000092054",
      "grch38:MYH7:14:1-2",
    ]);
    expect(v14qk.proposal("gep-aaa", "ws-1")).toEqual(["v14", "proposal", "gep-aaa", "ws-1"]);
    expect(v14qk.loci("UBERON:0000948", "ENSG00000092054")).toEqual(["v14", "loci", "UBERON:0000948", "ENSG00000092054"]);
    expect(v14qk.locusWindow("grch38:MYH7:14:1-2", 1, 40, "ws-1")).toEqual(["v14", "locus-window", "ws-1", "grch38:MYH7:14:1-2", 1, 40]);
    expect(v14qk.anatomyGenes("UBERON:0002398@left", "ws-1")).toEqual(["v14", "anatomy-genes", "ws-1", "UBERON:0002398@left"]);
  });

  it("exposes the V14 paths", () => {
    expect(V14.interpret).toBe("/api/genome-edit/interpret-command");
    expect(V14.apply("gep-aaa")).toBe("/api/genome-edit/proposals/gep-aaa/apply");
    expect(V14.voiceStatus).toBe("/api/voice/status");
  });
});

describe("anatomy / gene / locus URL params are ids only", () => {
  it("parses verified ids and preserves tab/workspace", () => {
    const parsed = parseAnatomyUrl("?tab=editor&workspace=ws-1a&anatomy=UBERON:0002398@left&gene=ENSG00000092054&locus=grch38:MYH7:14:23412700-23412939");
    expect(parsed).toMatchObject({
      anatomy: "UBERON:0002398@left",
      gene: "ENSG00000092054",
      locus: "grch38:MYH7:14:23412700-23412939",
      issues: [],
    });
    const next = serialiseAnatomyUrl(
      { anatomy: "UBERON:0000948", gene: null, locus: "ref_synthetic_chr22" },
      "?tab=editor&workspace=ws-1a",
    );
    expect(next).toContain("tab=editor");
    expect(next).toContain("workspace=ws-1a");
    expect(next).toContain("anatomy=UBERON%3A0000948");
    expect(next).toContain("locus=ref_synthetic_chr22");
    expect(next).not.toContain("gene=");
  });

  it("drops raw sequence and malformed ids", () => {
    expect(isAnatomyId("ACGTACGTACGTACGTACGT")).toBe(false);
    expect(isGeneId("MYH7")).toBe(false);
    expect(isLocusId("ACGTACGTACGTACGT")).toBe(false);
    const bad = parseAnatomyUrl("?anatomy=hand&gene=myh7&locus=ATCGATCGATCGATCGATCG");
    expect(bad.anatomy).toBeNull();
    expect(bad.gene).toBeNull();
    expect(bad.locus).toBeNull();
    expect(bad.issues.length).toBe(3);
  });
});
