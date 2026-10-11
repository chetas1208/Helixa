// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import * as dMem from "../../src/v12/api/simMemory";

const WS = "ws-abc123";
const ids = (n: number) => Array.from({ length: n }, (_, i) => `sim-${String(i + 1).padStart(4, "0")}`);
beforeEach(() => localStorage.clear());

describe("simulation id memory (ids only, never results or genomic data)", () => {
  it("D: newest first, dedupes, caps, validates shapes", () => {
    for (const id of ids(25)) dMem.rememberSimulation(WS, id);
    const got = dMem.recallSimulations(WS);
    expect(got).toHaveLength(dMem.SIM_MEMORY_LIMIT);
    expect(got[0]).toBe("sim-0025");
    dMem.rememberSimulation(WS, "sim-0010");
    expect(dMem.recallSimulations(WS)[0]).toBe("sim-0010");
    expect(new Set(dMem.recallSimulations(WS)).size).toBe(dMem.recallSimulations(WS).length);
  });

  it("D: hostile / corrupt storage is ignored, never thrown", () => {
    for (const raw of ["{not json", "123", '"x"', '{"a":1}', '["<script>","sim-ok1",42,null,{"x":1}]', "[]"]) {
      localStorage.setItem(dMem.SIM_MEMORY_PREFIX + WS, raw);
      expect(() => dMem.recallSimulations(WS)).not.toThrow();
      expect(dMem.recallSimulations(WS).every(dMem.isSimulationId)).toBe(true);
    }
    expect(dMem.rememberSimulation("not-a-workspace", "sim-1")).toEqual([]);
    expect(dMem.rememberSimulation(WS, "<img onerror=1>")).toEqual([]);
  });

  it("D: storage that throws (private mode / quota) does not break the session list", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(dMem.recallSimulations(WS, bad)).toEqual([]);
    expect(dMem.rememberSimulation(WS, "sim-1", bad)).toEqual(["sim-1"]);
    expect(dMem.recallSimulations(WS, null)).toEqual([]);
  });

  it("only simulation ids are written, under a workspace-namespaced key (privacy)", () => {
    dMem.rememberSimulation(WS, "sim-aaa111");
    dMem.rememberSimulation(WS, "sim-bbb222");
    const keys = Object.keys(localStorage);
    expect(keys).toEqual([dMem.SIM_MEMORY_PREFIX + WS]);
    expect(localStorage.getItem(keys[0]!)).toBe('["sim-bbb222","sim-aaa111"]');
  });
});
