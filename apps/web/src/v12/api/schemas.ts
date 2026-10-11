/**
 * Runtime contracts for every backend response the V12 UI consumes (zod).
 * Each schema `satisfies z.ZodType<T>` for the wire type in ../types.ts, so a drift between the
 * TS type and the validator is a compile error. Unknown extra fields are tolerated (stripped);
 * a response that is missing/mistyping a required field fails validation and the client raises
 * a typed ApiError (see client.ts, CONTRACT_MISMATCH_DETAIL) instead of reaching render state.
 */
import { z } from "zod";
import type {
  EnvironmentCatalog,
  EnvironmentPreset,
  Edit,
  FixtureItem,
  GenomeWindow,
  HarnessVersionSummary,
  Intelligence,
  ParameterSpec,
  Proposal,
  ReferenceInfo,
  Revision,
  Simulation,
  SimulationFrame,
  Workspace,
  WorkspaceList,
} from "../types";

export const ReferenceInfoSchema = z.object({
  reference_asset_id: z.string(),
  assembly: z.string(),
  contig: z.string(),
  length: z.number(),
  checksum_sha256: z.string(),
  official_grch38: z.boolean(),
  license_note: z.string(),
}) satisfies z.ZodType<ReferenceInfo>;

export const GenomeWindowSchema = z.object({
  assembly: z.string(),
  contig: z.string(),
  start: z.number(),
  end: z.number(),
  bases: z.string(),
  coordinate: z.string(),
  official_grch38: z.boolean(),
  checksum_sha256: z.string(),
}) satisfies z.ZodType<GenomeWindow>;

export const EditSchema = z.object({
  position: z.number(),
  ref: z.string(),
  alt: z.string(),
  current_allele_at_commit: z.string(),
}) satisfies z.ZodType<Edit>;

export const RevisionSchema = z.object({
  genome_revision_id: z.string(),
  parent_revision_id: z.string().nullable(),
  edits: z.array(EditSchema),
  preview_1_48: z.string(),
  sequence_sha256: z.string(),
  harness_version_id: z.string(),
  created_at: z.string(),
}) satisfies z.ZodType<Revision>;

export const WorkspaceSchema = z.object({
  workspace_id: z.string(),
  name: z.string(),
  reference_asset_id: z.string(),
  assembly: z.string(),
  official_grch38: z.boolean(),
  active_genome_revision_id: z.string(),
  active_harness_version_id: z.string(),
  revision_counter: z.number(),
  edit_count: z.number(),
  active_revision: RevisionSchema,
  status: z.string(),
  updated_at: z.string(),
  revisions: z.array(RevisionSchema).optional(),
  created_at: z.string().optional(),
}) satisfies z.ZodType<Workspace>;

export const WorkspaceListSchema = z.object({
  workspaces: z.array(WorkspaceSchema),
  active: WorkspaceSchema.nullable(),
}) satisfies z.ZodType<WorkspaceList>;

export const ProposalSchema = z.object({
  proposal_id: z.string(),
  workspace_id: z.string(),
  assembly: z.string(),
  contig: z.string(),
  position: z.number(),
  ref: z.string(),
  current_allele: z.string(),
  alt: z.string(),
  note: z.string(),
  status: z.string(),
  reason: z.string(),
  applied: z.boolean(),
}) satisfies z.ZodType<Proposal>;

export const IntelligenceSchema = z.object({
  workspace_id: z.string(),
  genome_revision_id: z.string(),
  harness_version_id: z.string(),
  same_identifier: z.boolean(),
  what_changed: z.array(EditSchema),
  what_was_computed: z.string(),
  hypothetical: z.string(),
  harness_adapted: z.string(),
  trust: z.string(),
  official_grch38: z.boolean(),
}) satisfies z.ZodType<Intelligence>;

export const ParameterSpecSchema = z.object({
  id: z.string(),
  category: z.string(),
  label: z.string(),
  unit: z.string(),
  default: z.number(),
  minimum: z.number(),
  maximum: z.number(),
  model_effect: z.string(),
  effect_status: z.string(),
  observed_or_assumed: z.string(),
  scientific_source: z.string(),
  help_text: z.string(),
}) satisfies z.ZodType<ParameterSpec>;

export const ParameterCatalogSchema = z.object({ parameters: z.array(ParameterSpecSchema) });
export type ParameterCatalog = z.infer<typeof ParameterCatalogSchema>;

export const EnvironmentPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  scope: z.string(),
  source: z.string(),
  values: z.record(z.number()),
}) satisfies z.ZodType<EnvironmentPreset>;

export const EnvironmentCatalogSchema = z.object({
  presets: z.array(EnvironmentPresetSchema),
  nasa_power: z.string(),
}) satisfies z.ZodType<EnvironmentCatalog>;

export const SimulationFrameSchema = z.object({
  generation: z.number(),
  simulated_years: z.number(),
  allele_frequency: z.number(),
  population_size: z.number(),
  extinct: z.boolean(),
  interpolated: z.boolean(),
}) satisfies z.ZodType<SimulationFrame>;

export const SimulationSchema = z.object({
  simulation_id: z.string(),
  workspace_id: z.string(),
  genome_revision_id: z.string(),
  harness_version_id: z.string(),
  playback_seconds: z.number(),
  engine: z.string(),
  engine_version: z.string(),
  fidelity: z.string(),
  fitness_class: z.string(),
  fitness_note: z.string(),
  fitness_focal: z.number(),
  fitness_other: z.number(),
  environment_effects: z.record(z.string()),
  seed: z.number(),
  generations_executed: z.number(),
  generation_time_years: z.number(),
  simulated_years: z.number(),
  population_size: z.number(),
  ploidy: z.number(),
  recombination: z.string(),
  limitations: z.array(z.string()),
  frames: z.array(SimulationFrameSchema),
  result_sha256: z.string(),
  narrative: z.string(),
}) satisfies z.ZodType<Simulation>;

export const FixtureItemSchema = z.object({
  name: z.string(),
  category: z.string(),
  description: z.string(),
}) satisfies z.ZodType<FixtureItem>;
export const FixtureCatalogSchema = z.object({ fixtures: z.array(FixtureItemSchema) });
export type FixtureCatalog = z.infer<typeof FixtureCatalogSchema>;

// ---------- Legacy surfaces (harness registry, health, voice) ----------

/** Harness version records carry many policy fields; keep them all (passthrough), require only an identity. */
export const HarnessVersionSummarySchema = z
  .object({
    id: z.string().optional(),
    version_id: z.string().optional(),
    status: z.string().optional(),
    parent_id: z.string().nullable().optional(),
  })
  .passthrough() satisfies z.ZodType<HarnessVersionSummary>;

export const HarnessListSchema = z.object({ harnesses: z.array(HarnessVersionSummarySchema) });
export type HarnessList = z.infer<typeof HarnessListSchema>;

export interface HarnessLineageNode {
  id: string;
  version_id?: string;
  harness_id?: string;
  status?: string;
  parent_id?: string | null;
  [k: string]: unknown;
}
export interface HarnessLineageEdge {
  source: string;
  target: string;
  label?: string;
}
export interface HarnessLineage {
  root_version_id: string;
  nodes: HarnessLineageNode[];
  edges: HarnessLineageEdge[];
}

export const HarnessLineageSchema = z.object({
  root_version_id: z.string(),
  nodes: z.array(
    z
      .object({
        id: z.string(),
        version_id: z.string().optional(),
        harness_id: z.string().optional(),
        status: z.string().optional(),
        parent_id: z.string().nullable().optional(),
      })
      .passthrough(),
  ),
  edges: z.array(z.object({ source: z.string(), target: z.string(), label: z.string().optional() })),
}) satisfies z.ZodType<HarnessLineage>;

/** Result of useHarnessLineage: a 404 means "nothing recorded", which is a normal, honest state. */
export type LineageResult =
  | { recorded: true; lineage: HarnessLineage }
  | { recorded: false; reason: string };

export interface HealthResponse {
  status: string;
  service?: string;
  version?: string;
  database?: string;
  mode?: string;
}
export const HealthResponseSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  version: z.string().optional(),
  database: z.string().optional(),
  mode: z.string().optional(),
}) satisfies z.ZodType<HealthResponse>;

export interface TranscriptionAvailability {
  available: boolean;
  reason: string;
}

/** Only the part of the OpenAPI document needed for capability probing. */
export const OpenApiPathsSchema = z.object({ paths: z.record(z.unknown()) });

/** GET /evolution/simulations?workspace_id= (present on newer backends). */
export const SimulationListSchema = z.object({ simulations: z.array(SimulationSchema) });

/** Which optional workspace routes this backend really has (see capabilities.ts). */
export interface WorkspaceCapabilities {
  rename: boolean;
  archive: boolean;
  listSimulations: boolean;
}
