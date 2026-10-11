/** Pure helpers over real simulation results: ownership checks, summaries, replicate bands, exports. */
import type { Simulation, SimulationFrame } from "../types";

export interface ExpectedRun {
  simulationId: string;
  workspaceId: string;
}

/** A run may be displayed only if it is exactly the one selected and belongs to the active workspace. */
export function checkRunOwnership(sim: Simulation | undefined, expected: ExpectedRun | null): { ok: true } | { ok: false; reason: string } {
  if (!sim || !expected) return { ok: false, reason: "No run selected." };
  if (sim.simulation_id !== expected.simulationId)
    return { ok: false, reason: `Result ${sim.simulation_id} does not match the selected run ${expected.simulationId}.` };
  if (sim.workspace_id !== expected.workspaceId)
    return { ok: false, reason: `Run ${sim.simulation_id} belongs to workspace ${sim.workspace_id}, not the active workspace.` };
  if (!sim.genome_revision_id) return { ok: false, reason: `Run ${sim.simulation_id} has no genome revision id.` };
  return { ok: true };
}

export interface RunSummary {
  start: number | null;
  end: number | null;
  extinct: boolean;
  extinctAtYear: number | null;
  fixedAt: "focal" | "other" | null;
  frames: number;
}

export function summarize(frames: readonly SimulationFrame[]): RunSummary {
  const first = frames[0];
  const last = frames[frames.length - 1];
  const ext = frames.find((f) => f.extinct);
  const fixedAt = !last || last.extinct ? null : last.allele_frequency >= 1 ? "focal" : last.allele_frequency <= 0 ? "other" : null;
  return {
    start: first ? first.allele_frequency : null,
    end: last ? last.allele_frequency : null,
    extinct: !!ext,
    extinctAtYear: ext ? ext.simulated_years : null,
    fixedAt,
    frames: frames.length,
  };
}

/** Everything about a run except its seed. Runs with equal keys are replicates of one scenario. */
export function replicateKey(s: Simulation): string {
  return JSON.stringify([
    s.workspace_id,
    s.genome_revision_id,
    s.generation_time_years,
    s.simulated_years,
    s.population_size,
    s.ploidy,
    s.fitness_class,
    s.fitness_focal,
    s.fitness_other,
    s.engine_version,
    s.frames[0]?.allele_frequency,
  ]);
}

export interface Band {
  years: number[];
  min: number[];
  max: number[];
  seeds: number[];
}

/** min/max envelope across >= 2 real runs on an identical frame grid; null otherwise. Never synthesised. */
export function replicateBand(runs: readonly Simulation[]): Band | null {
  if (runs.length < 2) return null;
  const grid = runs[0].frames.map((f) => f.simulated_years);
  for (const r of runs) {
    if (r.frames.length !== grid.length || r.frames.some((f, i) => f.simulated_years !== grid[i])) return null;
  }
  return {
    years: grid,
    min: grid.map((_, i) => Math.min(...runs.map((r) => r.frames[i].allele_frequency))),
    max: grid.map((_, i) => Math.max(...runs.map((r) => r.frames[i].allele_frequency))),
    seeds: runs.map((r) => r.seed),
  };
}

const csvCell = (v: string | number | boolean) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of the REAL recorded frames only (no interpolation rows). */
export function framesToCsv(sim: Simulation): string {
  const head = ["simulation_id", "workspace_id", "genome_revision_id", "seed", "result_sha256", "generation", "simulated_years", "allele_frequency", "population_size", "extinct", "interpolated"];
  const rows = sim.frames.map((f) =>
    [sim.simulation_id, sim.workspace_id, sim.genome_revision_id, sim.seed, sim.result_sha256, f.generation, f.simulated_years, f.allele_frequency, f.population_size, f.extinct, f.interpolated].map(csvCell).join(","),
  );
  return [head.join(","), ...rows].join("\n") + "\n";
}

export function framesToJson(sim: Simulation): string {
  return JSON.stringify(
    {
      simulation_id: sim.simulation_id,
      workspace_id: sim.workspace_id,
      genome_revision_id: sim.genome_revision_id,
      engine: sim.engine,
      engine_version: sim.engine_version,
      fidelity: sim.fidelity,
      seed: sim.seed,
      result_sha256: sim.result_sha256,
      generation_time_years: sim.generation_time_years,
      frames: sim.frames,
    },
    null,
    2,
  );
}

export const fmtYears = (y: number): string =>
  y >= 1e6 ? `${+(y / 1e6).toFixed(2)} M y` : y >= 1e3 ? `${+(y / 1e3).toFixed(1)} k y` : `${Math.round(y)} y`;
export const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");
