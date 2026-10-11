/**
 * V12 shared contracts. Wire types mirror the /api/v10 responses exactly (snake_case);
 * they are what the zod schemas in api/schemas.ts validate. Do not rename wire fields.
 *
 * Vocabulary (never blur these):
 *  - genome state     = reference + ordered in-silico edits (a Revision)
 *  - harness version  = the analysis agent's strategy/tools/context policy (NOT biology)
 *  - workspace        = genome state + active harness version + evidence + scenarios
 */

export type TabId = "editor" | "evolution" | "simulation" | "library";
export const TAB_ORDER: readonly TabId[] = ["editor", "evolution", "simulation", "library"] as const;
export const TAB_TITLES: Record<TabId, string> = {
  editor: "Genome Editor",
  evolution: "Genome & Harness Evolution",
  simulation: "Earth Evolution Sandbox",
  library: "Harness Library",
};

/** Scientific status vocabulary. Every claim shown in the UI carries exactly one. */
export type EvidenceKind = "REFERENCE" | "VALIDATED" | "SIMULATED" | "HYPOTHESIS" | "INCONCLUSIVE";

export type Nucleotide = "A" | "C" | "G" | "T";

// ---------- Reference + genome (wire) ----------

export interface ReferenceInfo {
  reference_asset_id: string;
  assembly: string;
  contig: string;
  length: number;
  checksum_sha256: string;
  official_grch38: boolean;
  license_note: string;
}

export interface GenomeWindow {
  assembly: string;
  contig: string;
  start: number;
  end: number;
  bases: string;
  coordinate: string; // "1-based inclusive"
  official_grch38: boolean;
  checksum_sha256: string;
}

export interface Edit {
  position: number; // 1-based
  ref: string;
  alt: string;
  current_allele_at_commit: string;
}

export interface Revision {
  genome_revision_id: string;
  parent_revision_id: string | null;
  edits: Edit[];
  preview_1_48: string;
  sequence_sha256: string;
  harness_version_id: string;
  created_at: string;
}

export interface Workspace {
  workspace_id: string;
  name: string;
  reference_asset_id: string;
  assembly: string;
  official_grch38: boolean;
  active_genome_revision_id: string;
  active_harness_version_id: string;
  revision_counter: number;
  edit_count: number;
  active_revision: Revision;
  status: string;
  updated_at: string;
  /** Present only on GET /workspaces/{id}: every revision, oldest first. */
  revisions?: Revision[];
  created_at?: string;
}

export interface WorkspaceList {
  workspaces: Workspace[];
  active: Workspace | null;
}

export type ProposalStatus = "READY" | "REJECTED" | string;

export interface Proposal {
  proposal_id: string;
  workspace_id: string;
  assembly: string;
  contig: string;
  position: number;
  ref: string;
  current_allele: string;
  alt: string;
  note: string;
  status: ProposalStatus;
  reason: string;
  applied: boolean;
}

export interface Intelligence {
  workspace_id: string;
  genome_revision_id: string;
  harness_version_id: string;
  same_identifier: boolean;
  what_changed: Edit[];
  what_was_computed: string;
  hypothetical: string;
  harness_adapted: string;
  trust: string;
  official_grch38: boolean;
}

// ---------- Simulation (wire) ----------

export type EffectStatus = "ACTIVE_MODELED" | "NOT_MODELED" | string;

export interface ParameterSpec {
  id: string;
  category: string;
  label: string;
  unit: string;
  default: number;
  minimum: number;
  maximum: number;
  model_effect: string;
  effect_status: EffectStatus;
  observed_or_assumed: string;
  scientific_source: string;
  help_text: string;
}

export interface EnvironmentPreset {
  id: string;
  label: string;
  scope: string;
  source: string;
  values: Record<string, number>;
}

export interface EnvironmentCatalog {
  presets: EnvironmentPreset[];
  nasa_power: string;
}

export interface SimulationRequest {
  workspace_id?: string | null;
  horizon_years: number;
  generation_time_years: number;
  population_size: number;
  initial_frequency: number;
  selection_coefficient: number;
  mutation_forward: number;
  migration_rate: number;
  migrant_frequency: number;
  seed: number;
  fitness_class: string;
  ploidy: number;
  temperature_c?: number | null;
  precipitation_mm_year?: number | null;
}

export interface SimulationFrame {
  generation: number;
  simulated_years: number;
  allele_frequency: number;
  population_size: number;
  extinct: boolean;
  interpolated: boolean;
}

export interface Simulation {
  simulation_id: string;
  workspace_id: string;
  genome_revision_id: string;
  harness_version_id: string;
  playback_seconds: number;
  engine: string;
  engine_version: string;
  fidelity: string;
  fitness_class: string;
  fitness_note: string;
  fitness_focal: number;
  fitness_other: number;
  environment_effects: Record<string, string>;
  seed: number;
  generations_executed: number;
  generation_time_years: number;
  simulated_years: number;
  population_size: number;
  ploidy: number;
  recombination: string;
  limitations: string[];
  frames: SimulationFrame[];
  result_sha256: string;
  narrative: string;
}

/** Hard backend budget: 2000 generations per run (see V12_REQUIRED_BACKEND_ENDPOINTS.md). */
export const SIM_GENERATION_BUDGET = 2000;
export const SIM_DEFAULT_HORIZON_YEARS = 2_000_000;
export const SIM_DEFAULT_PLAYBACK_SECONDS = 60;

// ---------- Legacy backend surfaces reused inside the four tabs ----------

export interface FixtureItem {
  name: string;
  category: string;
  description: string;
}

export interface HarnessVersionSummary {
  id?: string;
  version_id?: string;
  status?: string;
  parent_id?: string | null;
  [k: string]: unknown;
}

// ---------- Client-only draft model (Genome Editor) ----------

export interface DraftOp {
  position: number; // 1-based
  ref: string; // allele in the base revision at that position
  alt: Nucleotide;
  origin: "manual" | "text" | "voice";
}

/** Unsaved edit draft. Namespaced per workspace. Never authoritative. */
export interface EditDraft {
  workspaceId: string;
  baseRevisionId: string;
  baseCounter: number; // expected_counter for optimistic concurrency
  ops: DraftOp[];
  redo: DraftOp[];
}

export type DraftAction =
  | { type: "add"; op: DraftOp }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" }
  | { type: "rebase"; baseRevisionId: string; baseCounter: number };

export type ConnectionState = "online" | "degraded" | "offline" | "unknown";
