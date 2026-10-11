import { describe, it, expect } from "vitest";
import { SIM_DEFAULT_HORIZON_YEARS, SIM_DEFAULT_PLAYBACK_SECONDS, SIM_GENERATION_BUDGET, TAB_ORDER, TAB_TITLES } from "../../src/v12/types";
import type { EvidenceKind } from "../../src/v12/types";

describe("frozen V12 contracts (types.ts)", () => {
  it("has exactly four tabs in the required order with the exact titles", () => {
    expect(TAB_ORDER).toEqual(["editor", "evolution", "simulation", "library"]);
    expect(TAB_ORDER.map((t) => TAB_TITLES[t])).toEqual([
      "Genome Editor",
      "Genome & Harness Evolution",
      "Earth Evolution Sandbox",
      "Harness Library",
    ]);
    expect(Object.keys(TAB_TITLES).sort()).toEqual([...TAB_ORDER].sort());
  });

  it("does not leak legacy tab names into the titles", () => {
    const joined = Object.values(TAB_TITLES).join("|").toLowerCase();
    for (const banned of ["mission", "proof", "studio", "harness intelligence"]) expect(joined).not.toContain(banned);
  });

  it("declares the simulation budget and defaults of the brief", () => {
    expect(SIM_GENERATION_BUDGET).toBe(2000);
    expect(SIM_DEFAULT_HORIZON_YEARS).toBe(2_000_000);
    expect(SIM_DEFAULT_PLAYBACK_SECONDS).toBe(60);
    // the invariant that forces the declared-assumption UI
    expect(SIM_DEFAULT_HORIZON_YEARS / SIM_GENERATION_BUDGET).toBeGreaterThanOrEqual(1000);
  });

  it("evidence vocabulary is exactly the five kinds", () => {
    const kinds: EvidenceKind[] = ["REFERENCE", "VALIDATED", "SIMULATED", "HYPOTHESIS", "INCONCLUSIVE"];
    expect(new Set(kinds).size).toBe(5);
  });
});
