/** Pure scenario-draft helpers. The draft is editable state; results exist only after a real run returns frames. */
import { SIM_DEFAULT_HORIZON_YEARS, SIM_GENERATION_BUDGET } from "../types";
import type { SimulationRequest } from "../types";

export const HORIZON_CHOICES = [10_000, 100_000, 500_000, 1_000_000, 2_000_000] as const;
export const FITNESS_CLASSES = [
  { id: "EDUCATIONAL_TOY", label: "Educational toy coefficient", note: "s is applied as w = 1 + s. Not a measured fitness." },
  { id: "USER_ASSUMED", label: "User-assumed coefficient", note: "s is applied as w = 1 + s. You are declaring the assumption." },
  { id: "UNSUPPORTED", label: "Neutral drift only", note: "No fitness model; the engine refuses s other than 0." },
] as const;

export interface ScenarioDraft {
  horizon_years: number;
  /** DECLARED ASSUMPTION. Must be >= horizon / 2000 for the backend generation budget. */
  generation_time_years: number;
  population_size: number;
  initial_frequency: number;
  selection_coefficient: number;
  mutation_forward: number;
  migration_rate: number;
  migrant_frequency: number;
  fitness_class: string;
  seed: number;
  replicates: number;
  /** Context-only inputs (NOT_MODELED): stored with the run, never change allele counts. */
  temperature_c: number;
  precipitation_mm_year: number;
  altitude_m: number;
  presetId: string | null;
}

export const minGenerationTime = (horizonYears: number): number => (horizonYears > 0 ? horizonYears / SIM_GENERATION_BUDGET : 0);
export const generationCount = (horizonYears: number, generationTimeYears: number): number =>
  generationTimeYears > 0 ? horizonYears / generationTimeYears : Infinity;

export interface BudgetCheck {
  generations: number;
  minGenerationTime: number;
  ok: boolean;
}
export function budgetCheck(d: Pick<ScenarioDraft, "horizon_years" | "generation_time_years">): BudgetCheck {
  const generations = generationCount(d.horizon_years, d.generation_time_years);
  return { generations, minGenerationTime: minGenerationTime(d.horizon_years), ok: generations <= SIM_GENERATION_BUDGET };
}

export function defaultScenario(): ScenarioDraft {
  return {
    horizon_years: SIM_DEFAULT_HORIZON_YEARS,
    generation_time_years: minGenerationTime(SIM_DEFAULT_HORIZON_YEARS), // 1000 y/gen, declared
    population_size: 80,
    initial_frequency: 0.5,
    selection_coefficient: 0,
    mutation_forward: 0,
    migration_rate: 0,
    migrant_frequency: 0,
    fitness_class: "EDUCATIONAL_TOY",
    seed: 1,
    replicates: 1,
    temperature_c: 12,
    precipitation_mm_year: 900,
    altitude_m: 180,
    presetId: null,
  };
}

/** Soft slider ranges for the usable region; numeric inputs accept the full catalog range. */
export const SOFT_RANGE: Record<string, { min: number; max: number; step: number }> = {
  population_size: { min: 0, max: 500, step: 1 },
  initial_frequency: { min: 0, max: 1, step: 0.01 },
  selection_coefficient: { min: -0.1, max: 0.1, step: 0.001 },
  mutation_forward: { min: 0, max: 0.01, step: 0.0001 },
  migration_rate: { min: 0, max: 0.2, step: 0.005 },
  migrant_frequency: { min: 0, max: 1, step: 0.01 },
};

export function toRequest(d: ScenarioDraft, workspaceId: string, seed: number): SimulationRequest {
  return {
    workspace_id: workspaceId,
    horizon_years: d.horizon_years,
    generation_time_years: d.generation_time_years,
    population_size: Math.round(d.population_size),
    initial_frequency: d.initial_frequency,
    selection_coefficient: d.selection_coefficient,
    mutation_forward: d.mutation_forward,
    migration_rate: d.migration_rate,
    migrant_frequency: d.migrant_frequency,
    seed: Math.round(seed),
    fitness_class: d.fitness_class,
    ploidy: 1,
    temperature_c: d.temperature_c,
    precipitation_mm_year: d.precipitation_mm_year,
  };
}

/** Deterministic 64-bit-ish hash (two FNV-1a lanes) as 16 hex chars. Not cryptographic; used for idempotency keys. */
export function stableHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** Stable key for (scenario, workspace, exact genome revision, seed). Same inputs, same key; any change, new key. */
export function idempotencyKey(d: ScenarioDraft, workspaceId: string, revisionId: string, seed: number): string {
  const req = toRequest(d, workspaceId, seed);
  const canon = JSON.stringify(Object.keys(req).sort().map((k) => [k, (req as unknown as Record<string, unknown>)[k]]));
  return `v12-${stableHash(`${revisionId}|${canon}`)}`;
}

export function replicateSeeds(baseSeed: number, n: number): number[] {
  return Array.from({ length: Math.max(1, Math.min(8, Math.round(n))) }, (_, i) => Math.round(baseSeed) + i);
}

/** Non-scientific lighting preview values (0..1) derived from context inputs. Never feeds the model. */
export function lightingPreview(d: Pick<ScenarioDraft, "temperature_c" | "precipitation_mm_year">): { warmth: number; wetness: number } {
  const warmth = Math.min(1, Math.max(0, (d.temperature_c + 20) / 65));
  const wetness = Math.min(1, Math.max(0, d.precipitation_mm_year / 3000));
  return { warmth, wetness };
}
