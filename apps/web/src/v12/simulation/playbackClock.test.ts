import { describe, expect, it } from "vitest";
import { PlaybackController, elapsedForYear, frameAt, frameIndexAt, visibleYear } from "./playbackClock";
import type { SimulationFrame } from "../types";

const H = 2_000_000;
const frames: SimulationFrame[] = [0, 8, 16, 24].map((g, i) => ({
  generation: g,
  simulated_years: g * 1000,
  allele_frequency: [0.5, 0.6, 0.8, 1][i],
  population_size: 80,
  extinct: false,
  interpolated: false,
}));

function fake() {
  let t = 0;
  let cb: ((n: number) => void) | null = null;
  return {
    advance(ms: number) {
      t += ms;
      const c = cb;
      cb = null;
      c?.(t);
    },
    deps: { now: () => t, schedule: (c: (n: number) => void) => ((cb = c), () => { cb = null; }) },
  };
}

describe("visibleYear (2M years over 60 s)", () => {
  it("maps start, middle, end", () => {
    expect(visibleYear(0, 60, H)).toBe(0);
    expect(visibleYear(30, 60, H)).toBe(1_000_000);
    expect(visibleYear(60, 60, H)).toBe(H);
    expect(visibleYear(90, 60, H)).toBe(H);
    expect(visibleYear(15, 60, H, 100)).toBe(100 + 500_000);
    expect(elapsedForYear(1_000_000, 60, H)).toBe(30);
  });
});

describe("frame lookup", () => {
  it("shows the latest recorded frame at or before the year", () => {
    expect(frameIndexAt(frames, -1)).toBe(-1);
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 7_999)).toBe(0);
    expect(frameIndexAt(frames, 8_000)).toBe(1);
    expect(frameIndexAt(frames, 1e9)).toBe(3);
    const f = frameAt(frames, 12_000);
    expect(f.alleleFrequency).toBe(0.6);
    expect(f.interpolated).toBe(false);
  });
  it("interpolates only when enabled and flags it", () => {
    const f = frameAt(frames, 12_000, { interpolate: true });
    expect(f.interpolated).toBe(true);
    expect(f.alleleFrequency).toBeCloseTo(0.7, 10);
    expect(frameAt(frames, 8_000, { interpolate: true }).interpolated).toBe(false);
  });
});

describe("PlaybackController with a fake clock", () => {
  it("advances by wall time x speed, pause/seek/restart", () => {
    const f = fake();
    const c = new PlaybackController(60, H, 0, f.deps);
    c.play();
    f.advance(30_000);
    expect(c.snapshot().visibleYear).toBe(1_000_000);
    c.pause();
    f.advance(10_000);
    expect(c.snapshot().elapsedS).toBe(30);
    c.setSpeed(4);
    c.play();
    f.advance(5_000);
    expect(c.snapshot().elapsedS).toBe(50);
    c.seekYear(0);
    expect(c.snapshot().elapsedS).toBe(0);
    f.advance(1_000);
    expect(c.snapshot().elapsedS).toBe(4);
    c.restart();
    expect(c.snapshot().elapsedS).toBe(0);
    f.advance(60_000);
    expect(c.snapshot().ended).toBe(true);
    expect(c.snapshot().playing).toBe(false);
  });
  it("is frame-rate independent", () => {
    const a = fake();
    const b = fake();
    const ca = new PlaybackController(60, H, 0, a.deps);
    const cb = new PlaybackController(60, H, 0, b.deps);
    ca.play();
    cb.play();
    for (let i = 0; i < 600; i++) a.advance(100);
    for (let i = 0; i < 60; i++) b.advance(1000);
    expect(ca.snapshot().elapsedS).toBeCloseTo(cb.snapshot().elapsedS, 6);
  });
});
