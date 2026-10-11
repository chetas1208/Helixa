import { z } from "zod";
import type {
  ApplyEditResult,
  CommandIntent,
  GenomeEditProposal,
  InterpretCommandResponse,
  Locus,
  LocusWindow,
  SourceStatus,
  VoiceStatus,
} from "../contracts";

export const SourceStatusSchema = z.object({
  source_id: z.string(),
  status: z.enum(["live", "cached", "unavailable"]),
  version: z.string().nullable(),
  retrieved_at: z.string().nullable(),
}) satisfies z.ZodType<SourceStatus>;

export const InterpretCommandResponseSchema = z
  .object({
    intent: z.enum(["EXPLORE", "PRECISE_EDIT", "TRAIT_GOAL", "NEEDS_CLARIFICATION", "UNSUPPORTED"]) satisfies z.ZodType<CommandIntent>,
    explore: z
      .object({
        action: z.enum(["focus_anatomy", "show_genes", "show_gene_tissues", "show_sequence"]),
        anatomy_ids: z.array(z.string()),
        gene_ids: z.array(z.string()),
        locus_id: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    edit: z
      .object({
        locus_id: z.string().nullable().optional(),
        reference_asset_id: z.string(),
        assembly: z.string(),
        contig: z.string(),
        position: z.number(),
        stated_ref: z.string().nullable().optional(),
        alt: z.string(),
        actual_ref: z.string().optional(),
      })
      .nullable()
      .optional(),
    trait_goal: z
      .object({
        topic: z.string(),
        why_not_automatic: z.string(),
        related_anatomy_ids: z.array(z.string()),
        explore_actions: z.array(z.string()),
        complexity_notes: z.array(z.string()),
        research: z
          .object({
            user_intent: z.string(),
            research_area: z.string(),
            evidence: z.string(),
            candidate_edit: z.string(),
            dna_rendering: z.string(),
            body_rendering: z.string(),
            approval: z.string(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    reason: z.string(),
    parser: z.string(),
    source: z.enum(["text", "voice"]),
  })
  .passthrough() satisfies z.ZodType<InterpretCommandResponse>;

const ProposalCheckSchema = z.object({
  check: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});

export const GenomeEditProposalSchema = z
  .object({
    proposal_id: z.string(),
    workspace_id: z.string(),
    parent_revision_id: z.string(),
    reference_asset_id: z.string(),
    locus_id: z.string().nullable().optional(),
    assembly: z.string(),
    contig: z.string(),
    position: z.number(),
    reference_allele: z.string(),
    current_allele: z.string(),
    alternate_allele: z.string(),
    normalized_representation: z.string().nullable().optional(),
    validation_status: z.enum(["pending", "valid", "invalid", "inconclusive"]),
    checks: z.array(ProposalCheckSchema),
    consequence_status: z.enum(["not-computed", "computed", "unavailable"]),
    consequence: z
      .object({
        tool: z.string(),
        release: z.union([z.string(), z.number()]),
        most_severe_consequence: z.string(),
        transcript_consequences: z.array(
          z.object({
            transcript_id: z.string(),
            consequence_terms: z.array(z.string()),
            amino_acids: z.string().nullable().optional(),
            codons: z.string().nullable().optional(),
          }),
        ),
        computed_at: z.string(),
      })
      .nullable()
      .optional(),
    overlapping_features: z.array(
      z.object({
        feature_type: z.string(),
        id: z.string(),
        transcript_id: z.string().nullable().optional(),
      }),
    ),
    evidence_refs: z.array(z.string()),
    source: z.enum(["text", "voice", "manual"]),
    anatomy_id: z.string().nullable().optional(),
    created_at: z.string(),
  })
  .passthrough() satisfies z.ZodType<GenomeEditProposal>;

export const ApplyEditResultSchema = z
  .object({
    workspace: z
      .object({
        workspace_id: z.string(),
        revision_counter: z.number(),
        active_genome_revision_id: z.string(),
        active_harness_version_id: z.string(),
        edit_count: z.number(),
        official_grch38: z.boolean().optional(),
      })
      .passthrough(),
    revision: z.object({
      genome_revision_id: z.string(),
      parent_revision_id: z.string().nullable(),
      edits: z.array(
        z
          .object({
            position: z.number(),
            ref: z.string(),
            alt: z.string(),
            current_allele_at_commit: z.string(),
          })
          .passthrough(),
      ),
      preview_1_48: z.string(),
      sequence_sha256: z.string(),
      harness_version_id: z.string(),
      created_at: z.string(),
    }),
    receipt: z.object({
      proposal_id: z.string(),
      workspace_id: z.string(),
      genome_revision_id: z.string(),
      applied_at: z.string(),
    }),
  })
  .passthrough() satisfies z.ZodType<ApplyEditResult>;

export const VoiceStatusSchema = z.object({
  stt: z.enum(["CONFIGURED", "NOT_CONFIGURED", "VERIFIED"]),
  provider: z.string().nullable(),
  verified_at: z.string().nullable().optional(),
}) satisfies z.ZodType<VoiceStatus>;

export const LocusSchema = z
  .object({
    locus_id: z.string(),
    gene_id: z.string(),
    gene_symbol: z.string(),
    assembly: z.literal("GRCh38"),
    contig: z.string(),
    start: z.number(),
    end: z.number(),
    length: z.number(),
    gene_strand: z.union([z.literal(1), z.literal(-1)]),
    sequence_sha256: z.string(),
    reference_asset_id: z.string(),
    label: z.string(),
    features: z.array(
      z.object({
        feature_type: z.string(),
        id: z.string(),
        transcript_id: z.string().nullable().optional(),
        start: z.number(),
        end: z.number(),
        strand: z.union([z.literal(1), z.literal(-1)]),
      }),
    ),
    source: z.object({ name: z.string(), version: z.string(), url: z.string() }),
  })
  .passthrough() satisfies z.ZodType<Locus>;

export const LocusWindowSchema = z
  .object({
    locus_id: z.string(),
    assembly: z.literal("GRCh38"),
    contig: z.string(),
    start: z.number(),
    end: z.number(),
    bases: z.string(),
    coordinate: z.literal("1-based inclusive"),
    strand: z.literal("+"),
    sequence_sha256: z.string(),
    features: z.array(z.object({
      feature_type: z.string(),
      id: z.string(),
      transcript_id: z.string().nullable().optional(),
      start: z.number(),
      end: z.number(),
      strand: z.union([z.literal(1), z.literal(-1)]),
    })),
  })
  .passthrough() satisfies z.ZodType<LocusWindow>;

export const LociListSchema = z.object({ loci: z.array(LocusSchema) }).passthrough();

export const v14qk = {
  interpret: (workspaceId?: string | null, anatomyId?: string | null, geneId?: string | null, locusId?: string | null) =>
    ["v14", "interpret", workspaceId ?? "", anatomyId ?? "", geneId ?? "", locusId ?? ""] as const,
  proposal: (proposalId: string, workspaceId?: string | null) => ["v14", "proposal", proposalId, workspaceId ?? ""] as const,
  loci: (anatomyId?: string | null, geneId?: string | null) => ["v14", "loci", anatomyId ?? "", geneId ?? ""] as const,
  locusWindow: (locusId: string, start: number, end: number, workspaceId?: string | null) =>
    ["v14", "locus-window", workspaceId ?? "", locusId, start, end] as const,
  anatomy: (anatomyId: string) => ["v14", "anatomy", anatomyId] as const,
  anatomyGenes: (anatomyId: string, workspaceId?: string | null) => ["v14", "anatomy-genes", workspaceId ?? "", anatomyId] as const,
  gene: (geneId: string) => ["v14", "gene", geneId] as const,
  geneTissues: (geneId: string, anatomyId?: string | null) => ["v14", "gene-tissues", geneId, anatomyId ?? ""] as const,
  voiceStatus: ["v14", "voice-status"] as const,
};
