import { describe, it, expect } from "vitest";
import { FakeBackend, simRequest } from "../support/fakeBackend";
import { budgetCheck, defaultScenario, generationCount, idempotencyKey, lightingPreview, minGenerationTime, replicateSeeds, toRequest, type ScenarioDraft } from "../../src/v12/simulation/scenario";
import { checkRunOwnership, framesToCsv, framesToJson, replicateBand, replicateKey, summarize } from "../../src/v12/simulation/runData";
import { SIM_GENERATION_BUDGET, type Simulation } from "../../src/v12/types";

function sim(over: Partial<Parameters<FakeBackend["handle"]>[2] & object> = {}, wsIndex = 0, be = new FakeBackend()): { sim: Simulation; be: FakeBackend } {
  const id = be.workspaces[wsIndex]!.workspace_id;
  const r = be.handle("POST", "/api/v10/evolution/simulations", simRequest({ workspace_id: id, ...over }));
  expect(r.status).toBe(200);
  return { sim: r.json as Simulation, be };
}

describe("declared generation-time assumption (2000-generation budget)", () => {
  it("2,000,000 y => at least 1000 y/generation; default scenario declares exactly that", () => {
    expect(SIM_GENERATION_BUDGET).toBe(2000);
    expect(minGenerationTime(2_000_000)).toBe(1000);
    const d = defaultScenario();
    expect(d.horizon_years).toBe(2_000_000);
    expect(d.generation_time_years).toBeGreaterThanOrEqual(1000);
    expect(budgetCheck(d).ok).toBe(true);
  });
  it("25 y/gen over 2M y is flagged BEFORE any request (80,000 generations)", () => {
    const c = budgetCheck({ horizon_years: 2_000_000, generation_time_years: 25 });
    expect(c.ok).toBe(false);
    expect(c.generations).toBe(80_000);
    expect(c.minGenerationTime).toBe(1000);
  });
  it("min generation time for the horizon choices", () => {
    expect([10_000, 100_000, 500_000, 1_000_000, 2_000_000].map(minGenerationTime)).toEqual([5, 50, 250, 500, 1000]);
    expect(minGenerationTime(0)).toBe(0);
    expect(minGenerationTime(-5)).toBe(0);
    expect(generationCount(1000, 0)).toBe(Infinity);
  });
  it("budget boundary: exactly 2000 generations is ok, 2001 is not", () => {
    expect(budgetCheck({ horizon_years: 20_000, generation_time_years: 10 }).ok).toBe(true);
    expect(budgetCheck({ horizon_years: 20_010, generation_time_years: 10 }).ok).toBe(false);
  });
  it("toRequest sends the declared assumption, never a silently substituted 25 y", () => {
    const d: ScenarioDraft = { ...defaultScenario(), generation_time_years: 1000 };
    const req = toRequest(d, "ws-a", 3);
    expect(req.generation_time_years).toBe(1000);
    expect(req.horizon_years).toBe(2_000_000);
    expect(req.workspace_id).toBe("ws-a");
    expect(req.seed).toBe(3);
    expect(req.ploidy).toBe(1);
  });
});

describe("parameter edits never fabricate results", () => {
  it("scenario helpers are pure: toRequest / idempotencyKey do not mutate the draft and produce no frames", () => {
    const d = defaultScenario();
    const copy = JSON.stringify(d);
    const req = toRequest(d, "ws-a", 1);
    idempotencyKey(d, "ws-a", "rev-1", 1);
    expect(JSON.stringify(d)).toBe(copy);
    expect(req).not.toHaveProperty("frames");
    expect(Object.keys(req)).not.toContain("result_sha256");
  });
  it("lighting preview from context inputs is clamped 0..1 and independent of the request payload", () => {
    const d = defaultScenario();
    const before = toRequest(d, "ws-a", 1);
    const p = lightingPreview({ temperature_c: 1000, precipitation_mm_year: -5 });
    expect(p.warmth).toBe(1);
    expect(p.wetness).toBe(0);
    const warm = toRequest({ ...d, temperature_c: 40 }, "ws-a", 1);
    // context inputs ride along on the request but are labelled NOT_MODELED; the modelled fields stay identical
    for (const k of ["horizon_years", "generation_time_years", "population_size", "initial_frequency", "selection_coefficient", "mutation_forward", "migration_rate", "seed"] as const) expect(warm[k]).toBe(before[k]);
  });
  it("NOT_MODELED inputs do not change the real engine result (fake mirrors backend: allele counts identical)", () => {
    const be = new FakeBackend();
    const id = be.workspaces[0]!.workspace_id;
    const run = (extra: object) => be.handle("POST", "/api/v10/evolution/simulations", simRequest({ workspace_id: id, ...extra })).json as Simulation;
    expect(run({ temperature_c: 5 }).frames).toEqual(run({ temperature_c: 40, precipitation_mm_year: 3000 }).frames);
  });
  it("idempotency key: same scenario/workspace/revision/seed -> same key; any change -> different", () => {
    const d = defaultScenario();
    const k = idempotencyKey(d, "ws-a", "rev-1", 1);
    expect(idempotencyKey({ ...d }, "ws-a", "rev-1", 1)).toBe(k);
    expect(idempotencyKey(d, "ws-b", "rev-1", 1)).not.toBe(k);
    expect(idempotencyKey(d, "ws-a", "rev-2", 1)).not.toBe(k);
    expect(idempotencyKey(d, "ws-a", "rev-1", 2)).not.toBe(k);
    expect(idempotencyKey({ ...d, selection_coefficient: 0.01 }, "ws-a", "rev-1", 1)).not.toBe(k);
    expect(idempotencyKey({ ...d, generation_time_years: 2000 }, "ws-a", "rev-1", 1)).not.toBe(k);
  });
  it("replicate seeds are distinct, consecutive, capped at 8, at least 1", () => {
    expect(replicateSeeds(10, 3)).toEqual([10, 11, 12]);
    expect(replicateSeeds(1, 100)).toHaveLength(8);
    expect(replicateSeeds(1, 0)).toHaveLength(1);
    expect(new Set(replicateSeeds(5, 8)).size).toBe(8);
  });
});

describe("frames belong to the selected run + revision + workspace", () => {
  it("accepts only the exact selected run in the active workspace", () => {
    const { sim: s } = sim();
    expect(checkRunOwnership(s, { simulationId: s.simulation_id, workspaceId: s.workspace_id })).toEqual({ ok: true });
  });
  it("rejects a result for another run id (stale response from a previous selection)", () => {
    const { sim: s } = sim();
    const r = checkRunOwnership(s, { simulationId: "sim-other", workspaceId: s.workspace_id });
    expect(r.ok).toBe(false);
  });
  it("rejects a run from another workspace even if the id matches (no cross-workspace leakage)", () => {
    const be = new FakeBackend();
    be.createWorkspace("second");
    const { sim: s } = sim({}, 0, be);
    const r = checkRunOwnership(s, { simulationId: s.simulation_id, workspaceId: be.workspaces[1]!.workspace_id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/belongs to workspace/);
  });
  it("rejects missing run / missing selection / missing revision id", () => {
    const { sim: s } = sim();
    expect(checkRunOwnership(undefined, { simulationId: "x", workspaceId: "y" }).ok).toBe(false);
    expect(checkRunOwnership(s, null).ok).toBe(false);
    expect(checkRunOwnership({ ...s, genome_revision_id: "" }, { simulationId: s.simulation_id, workspaceId: s.workspace_id }).ok).toBe(false);
  });
  it("the run records the exact genome revision it was computed on, and a later edit does not retarget it", () => {
    const be = new FakeBackend();
    const w = be.workspaces[0]!;
    const { sim: s0 } = sim({}, 0, be);
    const revBefore = w.active_genome_revision_id;
    const p = be.handle("POST", `/api/v10/genome/workspaces/${w.workspace_id}/proposals`, { position: 4, alt: "A" }).json as { proposal_id: string };
    be.handle("POST", `/api/v10/genome/workspaces/${w.workspace_id}/commit`, { proposal_id: p.proposal_id, expected_counter: 1 });
    expect(w.active_genome_revision_id).not.toBe(revBefore);
    expect(be.sims.get(s0.simulation_id)!.genome_revision_id).toBe(revBefore);
    const { sim: s1 } = sim({}, 0, be);
    expect(s1.genome_revision_id).toBe(w.active_genome_revision_id);
  });
});

describe("summaries, replicates and export contain only real frames", () => {
  it("summarize: start/end/fixation/extinction", () => {
    const { sim: s } = sim({ selection_coefficient: 0.05 });
    const sum = summarize(s.frames);
    expect(sum.start).toBe(0.1);
    expect(sum.frames).toBe(s.frames.length);
    expect(sum.extinct).toBe(false);
    expect(summarize([]).start).toBeNull();
    const ex = summarize([{ generation: 0, simulated_years: 0, allele_frequency: 0.5, population_size: 10, extinct: false, interpolated: false }, { generation: 2, simulated_years: 2000, allele_frequency: 0, population_size: 0, extinct: true, interpolated: false }]);
    expect(ex).toMatchObject({ extinct: true, extinctAtYear: 2000, fixedAt: null });
  });
  it("replicates: band only when >= 2 real runs share one frame grid; differing seeds => differing curves", () => {
    const be = new FakeBackend();
    const a = sim({ seed: 1 }, 0, be).sim;
    const b = sim({ seed: 2 }, 0, be).sim;
    expect(replicateKey(a)).toBe(replicateKey(b));
    expect(a.result_sha256).not.toBe(b.result_sha256);
    const band = replicateBand([a, b])!;
    expect(band.seeds).toEqual([1, 2]);
    expect(band.min.every((v, i) => v <= band.max[i]!)).toBe(true);
    expect(replicateBand([a])).toBeNull();
    const shorter: Simulation = { ...b, frames: b.frames.slice(0, -1) };
    expect(replicateBand([a, shorter])).toBeNull();
  });
  it("different scenarios are never grouped as replicates", () => {
    const be = new FakeBackend();
    const a = sim({ seed: 1, population_size: 1000 }, 0, be).sim;
    const b = sim({ seed: 2, population_size: 500 }, 0, be).sim;
    expect(replicateKey(a)).not.toBe(replicateKey(b));
  });
  it("CSV has one row per recorded frame plus header, carries run ids + sha, no interpolated rows", () => {
    const { sim: s } = sim();
    const csv = framesToCsv(s).trimEnd().split("\n");
    expect(csv).toHaveLength(s.frames.length + 1);
    expect(csv[0]).toContain("simulation_id,workspace_id,genome_revision_id,seed,result_sha256");
    expect(csv[1]).toContain(s.simulation_id);
    expect(csv[1]).toContain(s.result_sha256);
    expect(csv.slice(1).every((r) => r.endsWith(",false"))).toBe(true);
  });
  it("JSON export round-trips the exact frames", () => {
    const { sim: s } = sim();
    const j = JSON.parse(framesToJson(s));
    expect(j.frames).toEqual(s.frames);
    expect(j.simulation_id).toBe(s.simulation_id);
    expect(j.result_sha256).toBe(s.result_sha256);
  });
});
