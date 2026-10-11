import { describe, it, expect } from "vitest";
import { PlaybackController, SPEEDS, elapsedForYear, frameAt, frameIndexAt, visibleYear, type PlaybackSnapshot } from "../../src/v12/simulation/playbackClock";
import type { SimulationFrame } from "../../src/v12/types";

const H = 2_000_000;
const P = 60;

/** Fake monotonic clock + manual scheduler: nothing here touches requestAnimationFrame or wall time. */
function fakeClock() {
  let t = 1000; // arbitrary non-zero origin
  let pending: ((n: number) => void) | null = null;
  let scheduled = 0;
  return {
    get now() { return t; },
    get scheduled() { return scheduled; },
    get hasPending() { return pending !== null; },
    /** advance wall time and fire the scheduled frame callback once (like one rAF tick) */
    step(ms: number) { t += ms; const c = pending; pending = null; c?.(t); },
    jump(ms: number) { t += ms; },
    deps: { now: () => t, schedule: (c: (n: number) => void) => { pending = c; scheduled++; return () => { pending = null; }; } },
  };
}
const mk = (opts: { playback?: number; horizon?: number; start?: number } = {}) => {
  const clock = fakeClock();
  const ctl = new PlaybackController(opts.playback ?? P, opts.horizon ?? H, opts.start ?? 0, clock.deps);
  return { clock, ctl };
};

describe("visibleYear: 2,000,000 years over 60 s", () => {
  it("start / quarter / mid / three-quarter / end", () => {
    expect(visibleYear(0, P, H)).toBe(0);
    expect(visibleYear(15, P, H)).toBe(500_000);
    expect(visibleYear(30, P, H)).toBe(1_000_000);
    expect(visibleYear(45, P, H)).toBe(1_500_000);
    expect(visibleYear(60, P, H)).toBe(2_000_000);
  });
  it("clamps after the end and before the start", () => {
    expect(visibleYear(60.0001, P, H)).toBe(H);
    expect(visibleYear(1e9, P, H)).toBe(H);
    expect(visibleYear(-5, P, H)).toBe(0);
  });
  it("honours a non-zero start year (start_year + frac*horizon)", () => {
    expect(visibleYear(30, P, H, 100)).toBe(1_000_100);
    expect(visibleYear(60, P, H, 100)).toBe(2_000_100);
  });
  it("degenerate inputs never produce NaN/Infinity", () => {
    for (const [e, p] of [[NaN, 60], [Infinity, 60], [10, 0], [10, -1], [10, NaN]] as [number, number][]) {
      expect(Number.isFinite(visibleYear(e, p, H))).toBe(true);
    }
  });
  it("is linear for other horizons (10k, 1M) and other playback lengths", () => {
    expect(visibleYear(6, 12, 10_000)).toBe(5_000);
    expect(visibleYear(30, 60, 1_000_000)).toBe(500_000);
    expect(visibleYear(30, 30, 1_000_000)).toBe(1_000_000);
  });
  it("elapsedForYear is the inverse and clamps", () => {
    for (const y of [0, 1, 123_456, 1_000_000, 2_000_000]) expect(visibleYear(elapsedForYear(y, P, H), P, H)).toBeCloseTo(y, 6);
    expect(elapsedForYear(-1, P, H)).toBe(0);
    expect(elapsedForYear(5e9, P, H)).toBe(P);
    expect(elapsedForYear(10, P, 0)).toBe(0);
  });
});

describe("PlaybackController with a fake clock", () => {
  it("plays for exactly 60 s at 1x: 30 s -> 1M years, end clamps and stops", () => {
    const { clock, ctl } = mk();
    ctl.play();
    clock.step(30_000);
    expect(ctl.snapshot().visibleYear).toBe(1_000_000);
    expect(ctl.snapshot().ended).toBe(false);
    clock.step(30_000);
    const s = ctl.snapshot();
    expect(s.visibleYear).toBe(H);
    expect(s.ended).toBe(true);
    expect(s.playing).toBe(false);
    expect(clock.hasPending).toBe(false); // no leaked rAF after the end
    clock.step(10_000);
    expect(ctl.snapshot().elapsedS).toBe(60);
  });

  it("is independent of frame rate: 3750 x 16 ms ticks == 4 x 15 s ticks == 1 x 60 s tick", () => {
    const run = (stepMs: number, n: number) => {
      const { clock, ctl } = mk();
      ctl.play();
      for (let i = 0; i < n; i++) clock.step(stepMs);
      return ctl.snapshot().elapsedS;
    };
    expect(run(16, 1875)).toBeCloseTo(30, 6);
    expect(run(15_000, 2)).toBeCloseTo(30, 6);
    expect(run(30_000, 1)).toBeCloseTo(30, 6);
    expect(run(33.3333333, 900)).toBeCloseTo(30, 3); // a 30 fps device reaches the same modelled year
  });

  it("pause freezes the year while wall time passes; resume continues without a jump", () => {
    const { clock, ctl } = mk();
    ctl.play();
    clock.step(10_000);
    ctl.pause();
    const frozen = ctl.snapshot().visibleYear;
    clock.jump(30_000);
    clock.step(30_000);
    expect(ctl.snapshot().visibleYear).toBe(frozen);
    expect(ctl.snapshot().playing).toBe(false);
    ctl.play();
    clock.step(5_000);
    expect(ctl.snapshot().elapsedS).toBeCloseTo(15, 6);
  });

  it("pause banks the time elapsed since the last tick", () => {
    const { clock, ctl } = mk();
    ctl.play();
    clock.jump(7_000); // no rAF tick fired yet
    ctl.pause();
    expect(ctl.snapshot().elapsedS).toBeCloseTo(7, 6);
  });

  it("speed multiplies playback time: a quarter of the run (15 s of model playback) takes 15/speed wall seconds", () => {
    for (const speed of SPEEDS) {
      const { clock, ctl } = mk();
      ctl.setSpeed(speed);
      ctl.play();
      clock.step((15 / speed) * 1000);
      expect(ctl.snapshot().visibleYear).toBeCloseTo(500_000, 3);
    }
    const { clock, ctl } = mk();
    ctl.setSpeed(4);
    ctl.play();
    clock.step(7_500);
    expect(ctl.snapshot().visibleYear).toBe(1_000_000);
  });

  it("changing speed mid-playback banks time at the old speed (no retroactive rescale)", () => {
    const { clock, ctl } = mk();
    ctl.play();
    clock.step(10_000); // 10 s at 1x
    ctl.setSpeed(4);
    clock.step(5_000); // 20 s at 4x
    expect(ctl.snapshot().elapsedS).toBeCloseTo(30, 6);
    expect(ctl.snapshot().visibleYear).toBeCloseTo(1_000_000, 3);
  });

  it("invalid speed falls back to 1x", () => {
    const { clock, ctl } = mk();
    ctl.setSpeed(0);
    ctl.setSpeed(-3);
    ctl.play();
    clock.step(1000);
    expect(ctl.snapshot().elapsedS).toBeCloseTo(1, 6);
  });

  it("seekYear / seekElapsed jump while paused or playing, and clamp", () => {
    const { clock, ctl } = mk();
    ctl.seekYear(1_500_000);
    expect(ctl.snapshot().elapsedS).toBeCloseTo(45, 6);
    ctl.seekYear(-10);
    expect(ctl.snapshot().elapsedS).toBe(0);
    ctl.seekElapsed(1000);
    expect(ctl.snapshot().elapsedS).toBe(60);
    ctl.seekElapsed(0);
    ctl.play();
    clock.step(10_000);
    ctl.seekYear(1_000_000);
    clock.step(1_000);
    expect(ctl.snapshot().elapsedS).toBeCloseTo(31, 6); // time since the seek, not since the last tick
  });

  it("restart returns to year 0 and (optionally) autoplays", () => {
    const { clock, ctl } = mk();
    ctl.play();
    clock.step(60_000);
    expect(ctl.snapshot().ended).toBe(true);
    ctl.restart();
    expect(ctl.snapshot().visibleYear).toBe(0);
    expect(ctl.snapshot().playing).toBe(false);
    ctl.restart(true);
    expect(ctl.snapshot().playing).toBe(true);
    clock.step(1_000);
    expect(ctl.snapshot().elapsedS).toBeCloseTo(1, 6);
  });

  it("pressing play at the end restarts from year 0", () => {
    const { clock, ctl } = mk();
    ctl.play();
    clock.step(61_000);
    ctl.play();
    expect(ctl.snapshot().elapsedS).toBe(0);
    expect(ctl.snapshot().playing).toBe(true);
  });

  it("hidden tab: suspendWallClock banks time and resume does not jump", () => {
    const { clock, ctl } = mk();
    ctl.play();
    clock.step(5_000);
    ctl.suspendWallClock();
    clock.jump(600_000); // ten minutes in a background tab
    ctl.resumeWallClock();
    clock.step(1_000);
    expect(ctl.snapshot().elapsedS).toBeCloseTo(6, 6);
    expect(ctl.snapshot().ended).toBe(false);
  });

  it("a non-monotonic clock sample never moves time backwards", () => {
    const { clock, ctl } = mk();
    ctl.play();
    clock.step(5_000);
    ctl.tick(clock.now - 3_000);
    expect(ctl.snapshot().elapsedS).toBeCloseTo(5, 6);
  });

  it("emits snapshots to subscribers and unsubscribes cleanly; dispose cancels the rAF", () => {
    const { clock, ctl } = mk();
    const seen: PlaybackSnapshot[] = [];
    const off = ctl.subscribe((s) => seen.push(s));
    ctl.play();
    clock.step(1000);
    expect(seen.length).toBeGreaterThan(1);
    off();
    const n = seen.length;
    clock.step(1000);
    expect(seen.length).toBe(n);
    ctl.dispose();
    expect(clock.hasPending).toBe(false);
    expect(ctl.snapshot().playing).toBe(false);
  });

  it("configure() re-clamps elapsed when the run changes (new run starts consistent)", () => {
    const { ctl } = mk();
    ctl.seekElapsed(50);
    ctl.configure(30, 1_000_000);
    expect(ctl.snapshot().elapsedS).toBe(30);
    expect(ctl.snapshot().visibleYear).toBe(1_000_000);
  });

  it("deterministic: same inputs produce the same trajectory", () => {
    const trace = () => {
      const { clock, ctl } = mk();
      const out: number[] = [];
      ctl.setSpeed(2);
      ctl.play();
      for (let i = 0; i < 10; i++) { clock.step(777); out.push(ctl.snapshot().visibleYear); }
      return out;
    };
    expect(trace()).toEqual(trace());
  });
});

describe("discrete frames and honest interpolation", () => {
  const fr = (g: number, af: number, extra: Partial<SimulationFrame> = {}): SimulationFrame => ({ generation: g, simulated_years: g * 1000, allele_frequency: af, population_size: 100, extinct: false, interpolated: false, ...extra });
  const frames = [fr(0, 0.5), fr(8, 0.6), fr(16, 0.8), fr(24, 1)];

  it("a frame appears at its recorded boundary, never before", () => {
    expect(frameIndexAt(frames, -1)).toBe(-1);
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 7_999)).toBe(0);
    expect(frameIndexAt(frames, 8_000)).toBe(1);
    expect(frameIndexAt(frames, 8_001)).toBe(1);
    expect(frameIndexAt(frames, 1e12)).toBe(3);
    expect(frameIndexAt([], 5)).toBe(-1);
  });

  it("discrete lookup returns recorded values unchanged and flagged not interpolated", () => {
    const r = frameAt(frames, 12_000);
    expect(r.frame).toBe(frames[1]);
    expect(r.alleleFrequency).toBe(0.6);
    expect(r.interpolated).toBe(false);
  });

  it("interpolation is opt-in, lies strictly between frames and is flagged", () => {
    const mid = frameAt(frames, 12_000, { interpolate: true });
    expect(mid.alleleFrequency).toBeCloseTo(0.7, 9);
    expect(mid.interpolated).toBe(true);
    const onBoundary = frameAt(frames, 8_000, { interpolate: true });
    expect(onBoundary.alleleFrequency).toBe(0.6);
    expect(onBoundary.interpolated).toBe(false);
    const afterEnd = frameAt(frames, 9_999_999, { interpolate: true });
    expect(afterEnd.alleleFrequency).toBe(1);
    expect(afterEnd.interpolated).toBe(false);
  });

  it("never interpolates across extinction", () => {
    const f = [fr(0, 0.5), fr(8, 0, { extinct: true, population_size: 0 })];
    expect(frameAt(f, 4_000, { interpolate: true }).interpolated).toBe(false);
    expect(frameAt(f, 4_000, { interpolate: true }).alleleFrequency).toBe(0.5);
  });

  it("year before the first frame shows nothing instead of fabricating a value", () => {
    const f = [fr(2, 0.5)];
    const r = frameAt(f, 100);
    expect(r.frame).toBeNull();
    expect(r.alleleFrequency).toBeNull();
  });

  it("full 60 s replay against 240 real frames: monotone index, first and last frames hit", () => {
    const big = Array.from({ length: 240 }, (_, i) => fr(Math.round((i * 2000) / 239), i / 239));
    const { clock, ctl } = mk();
    ctl.play();
    let prev = -1;
    for (let i = 0; i < 600; i++) {
      clock.step(100);
      const idx = frameAt(big, ctl.snapshot().visibleYear).index;
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
    expect(prev).toBe(239);
    expect(ctl.snapshot().ended).toBe(true);
  });
});
