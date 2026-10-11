/**
 * V14 wire contract (snake_case, mirrors docs/milestones/V14_UI_CONTRACTS.md). Owner: Agent 4.
 * Runtime validation lives in `src/v14/api/schemas.ts`; these are the static types every agent imports.
 */

export type AnatomyType =
  | "region" | "organ" | "tissue" | "cell-type" | "bone" | "muscle" | "nerve" | "vessel" | "system-part" | "joint" | "gland";
export type Laterality = "left" | "right" | "midline" | "none";
export type MeshStatus = "modeled" | "approximate" | "unavailable";
export type AnatomyLevel = "A" | "B" | "C" | "D";

export interface SourceRef { name: string; version: string; url: string }

export interface AnatomyNode {
  id: string;
  ontology_id: string | null;
  ontology_status: "verified" | "unmapped";
  label: string;
  ontology_label?: string | null;
  synonyms: string[];
  type: AnatomyType;
  parent_ids: string[];
  system_ids: string[];
  laterality: Laterality;
  level: AnatomyLevel;
  asset_ids: string[];
  mesh_status: MeshStatus;
  focus_fallback_id?: string | null;
  tissue_context_ids: string[];
  description?: string | null;
  description_source?: SourceRef | null;
  source: SourceRef;
}

export interface BodySystem { id: string; label: string; ontology_id: string | null; member_ids?: string[]; source?: SourceRef }

export type RelationshipKind =
  | "ANATOMICAL_PART_OF" | "SYSTEM_MEMBERSHIP" | "GENE_EXPRESSED_IN" | "REGULATORY_ASSOCIATION_IN_TISSUE"
  | "VARIANT_TRAIT_ASSOCIATION" | "CURATED_GENE_PHENOTYPE_RELATIONSHIP" | "VISUAL_ASSET_FOR_ANATOMY"
  | "EDIT_OVERLAPS_GENE_OR_REGULATORY_REGION";

export interface Relationship { kind: RelationshipKind; subject_id: string; object_id: string; source_id: string; source_version: string; source_url: string }

export type EvidenceKind =
  | "anatomical-part-of" | "tissue-expression" | "regulatory-association" | "variant-trait-association"
  | "curated-gene-phenotype" | "genomic-overlap";

export type InterpretationTier =
  | "reference-fact" | "observed-expression" | "statistical-association" | "curated-relationship"
  | "predicted-hypothesis" | "unknown";

export interface GeneTissueEvidence {
  evidence_id: string;
  gene_id: string;
  gene_symbol: string;
  anatomy_id: string;
  measured_anatomy_id: string;
  measured_anatomy_label: string;
  evidence_kind: EvidenceKind;
  interpretation_tier: InterpretationTier;
  source_id: string;
  source_version: string;
  retrieved_at: string;
  study_or_record_id?: string | null;
  context?: string | null;
  quantitative_value?: number | null;
  units?: string | null;
  qualitative_label?: string | null;
  uncertainty?: string | null;
  source_url: string;
  caveat: string;
}

export type SourceLiveness = "live" | "cached" | "unavailable";
export interface SourceStatus { source_id: string; status: SourceLiveness; version: string | null; retrieved_at: string | null }

export interface Gene {
  gene_id: string;
  version: number;
  symbol: string;
  description: string;
  biotype: string;
  assembly: "GRCh38";
  assembly_patch: string;
  ensembl_release: number;
  contig: string;
  start: number;
  end: number;
  strand: 1 | -1;
  canonical_transcript: string;
  locus_ids: string[];
  panel_reason?: string | null;
  source: SourceRef;
}

export interface LocusFeature { feature_type: string; id: string; transcript_id?: string | null; start: number; end: number; strand: 1 | -1 }

export interface Locus {
  locus_id: string;
  gene_id: string;
  gene_symbol: string;
  assembly: "GRCh38";
  contig: string;
  start: number;
  end: number;
  length: number;
  gene_strand: 1 | -1;
  sequence_sha256: string;
  reference_asset_id: string;
  label: string;
  features: LocusFeature[];
  source: SourceRef;
}

export interface LocusWindow {
  locus_id: string;
  assembly: "GRCh38";
  contig: string;
  start: number;
  end: number;
  bases: string;
  coordinate: "1-based inclusive";
  strand: "+";
  sequence_sha256: string;
  features: LocusFeature[];
}

export type SearchResultType = "anatomy" | "system" | "gene" | "locus" | "variant" | "trait" | "evidence-category";
export interface SearchResult { result_type: SearchResultType; id: string; label: string; matched: string; score: number; laterality?: Laterality | null; corrected_from?: string | null }

/** Honest research record for a trait wish. Never contains an invented allele. */
export interface TraitResearchProposal {
  user_intent: string;
  research_area: string;
  evidence: string;
  candidate_edit: string;
  dna_rendering: string;
  body_rendering: string;
  approval: string;
}

export type CommandIntent = "EXPLORE" | "PRECISE_EDIT" | "TRAIT_GOAL" | "NEEDS_CLARIFICATION" | "UNSUPPORTED";
export interface InterpretCommandRequest {
  text: string;
  workspace_id?: string | null;
  source: "text" | "voice";
  selection?: { anatomy_id?: string | null; gene_id?: string | null; locus_id?: string | null; position?: number | null };
}
export interface InterpretCommandResponse {
  intent: CommandIntent;
  explore?: { action: "focus_anatomy" | "show_genes" | "show_gene_tissues" | "show_sequence"; anatomy_ids: string[]; gene_ids: string[]; locus_id?: string | null } | null;
  edit?: { locus_id?: string | null; reference_asset_id: string; assembly: string; contig: string; position: number; stated_ref?: string | null; alt: string; actual_ref?: string | null } | null;
  trait_goal?: {
    topic: string;
    why_not_automatic: string;
    related_anatomy_ids: string[];
    explore_actions: string[];
    complexity_notes: string[];
    research?: TraitResearchProposal | null;
  } | null;
  reason: string;
  parser: string;
  source: "text" | "voice";
}

export type ValidationStatus = "pending" | "valid" | "invalid" | "inconclusive";
export type ConsequenceStatus = "not-computed" | "computed" | "unavailable";
export interface ProposalCheck { check: string; passed: boolean; detail: string }
export interface VepConsequence {
  tool: string;
  release: string | number;
  most_severe_consequence: string;
  transcript_consequences: { transcript_id: string; consequence_terms: string[]; amino_acids?: string | null; codons?: string | null }[];
  computed_at: string;
}
export interface GenomeEditProposal {
  proposal_id: string;
  workspace_id: string;
  parent_revision_id: string;
  reference_asset_id: string;
  locus_id?: string | null;
  assembly: string;
  contig: string;
  position: number;
  reference_allele: string;
  current_allele: string;
  alternate_allele: string;
  normalized_representation?: string | null;
  validation_status: ValidationStatus;
  checks: ProposalCheck[];
  consequence_status: ConsequenceStatus;
  consequence?: VepConsequence | null;
  overlapping_features: { feature_type: string; id: string; transcript_id?: string | null }[];
  evidence_refs: string[];
  source: "text" | "voice" | "manual";
  anatomy_id?: string | null;
  created_at: string;
}

export interface AnatomicalSelection {
  workspace_id: string;
  genome_revision_id: string;
  anatomy_id: string;
  gene_id?: string | null;
  transcript_id?: string | null;
  locus?: { assembly: "GRCh38" | string; contig: string; start: number; end: number } | null;
}

export type VoiceSttStatus = "CONFIGURED" | "NOT_CONFIGURED" | "VERIFIED";
export interface VoiceStatus {
  stt: VoiceSttStatus;
  provider: string | null;
  verified_at?: string | null;
}

export interface RevisionEdit {
  position: number;
  ref: string;
  alt: string;
  current_allele_at_commit: string;
  reference_asset_id?: string | null;
  locus_id?: string | null;
  assembly?: string | null;
  contig?: string | null;
  gene_id?: string | null;
  gene_symbol?: string | null;
  anatomy_ids?: string[];
  proposal_id?: string | null;
}

export interface EditsSummary {
  gene_symbol?: string | null;
  locus_id?: string | null;
  position: number;
  ref: string;
  alt: string;
  anatomy_ids: string[];
}

export interface ApplyEditReceipt {
  proposal_id: string;
  workspace_id: string;
  genome_revision_id: string;
  applied_at: string;
}

export interface ApplyEditResult {
  workspace: {
    workspace_id: string;
    revision_counter: number;
    active_genome_revision_id: string;
    active_harness_version_id: string;
    edit_count: number;
    official_grch38?: boolean;
  };
  revision: {
    genome_revision_id: string;
    parent_revision_id: string | null;
    edits: RevisionEdit[];
    preview_1_48: string;
    sequence_sha256: string;
    harness_version_id: string;
    created_at: string;
  };
  receipt: ApplyEditReceipt;
}

/** Plain-language tier labels for the UI (text + icon, never colour alone). */
export const TIER_LABEL: Record<InterpretationTier, string> = {
  "reference-fact": "Reference anatomy",
  "observed-expression": "Observed tissue expression",
  "statistical-association": "Statistical association",
  "curated-relationship": "Curated gene–phenotype link",
  "predicted-hypothesis": "Predicted / hypothetical",
  unknown: "No reliable evidence",
};
