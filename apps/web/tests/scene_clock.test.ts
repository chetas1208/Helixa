import { describe, it, expect } from "vitest";
import { SceneClock } from "../src/scenes/SceneClock";

describe("SceneClock 300-Second Visual Cycle", () => {
  it("computes deterministic visual parameters at timestamp 0s", () => {
    const params = SceneClock.computeVisualParams(0);
    expect(params.cycleIndex).toBe(0);
    expect(params.phase).toBe(0);
    expect(params.styleName).toBe("Molecular Glass");
    expect(params.primaryColor).toBe("#00f0ff");
    expect(params.radius).toBeCloseTo(1.2, 2);
  });

  it("computes deterministic visual parameters at timestamp 45s", () => {
    const params = SceneClock.computeVisualParams(45);
    expect(params.cycleIndex).toBe(0);
    expect(params.phase).toBeCloseTo(0.15, 2);
    expect(params.styleName).toBe("Molecular Glass");
  });

  it("computes deterministic visual parameters at timestamp 90s", () => {
    const params = SceneClock.computeVisualParams(90);
    expect(params.cycleIndex).toBe(0);
    expect(params.phase).toBeCloseTo(0.30, 2);
    expect(params.styleName).toBe("Molecular Glass");
  });

  it("smoothly morphs during transition window at timestamp 290s (phase 0.966)", () => {
    const params = SceneClock.computeVisualParams(290);
    expect(params.cycleIndex).toBe(0);
    expect(params.phase).toBeGreaterThan(0.9);
    // Radius interpolates towards Luminous Strand (1.3)
    expect(params.radius).toBeGreaterThan(1.2);
    expect(params.radius).toBeLessThanOrEqual(1.3);
  });

  it("advances to cycle 1 after 300s rollover", () => {
    const params = SceneClock.computeVisualParams(300);
    expect(params.cycleIndex).toBe(1);
    expect(params.phase).toBe(0);
    expect(params.styleName).toBe("Luminous Strand");
    expect(params.primaryColor).toBe("#a855f7");
  });

  it("converges to exact same parameters on identical timestamp input", () => {
    const p1 = SceneClock.computeVisualParams(142.5);
    const p2 = SceneClock.computeVisualParams(142.5);
    expect(p1.rotationAngle).toBe(p2.rotationAngle);
    expect(p1.radius).toBe(p2.radius);
    expect(p1.primaryColor).toBe(p2.primaryColor);
  });
});
