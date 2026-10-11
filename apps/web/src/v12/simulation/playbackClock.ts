/**
 * Pure, deterministic playback clock for the Earth Simulation tab.
 *
 *   visible_year = start_year + (elapsed_s / playback_s) * horizon_years
 *
 * Playback duration is separate from modelled time. Recorded frames are discrete: the frame shown at a
 * given visible year is the latest frame recorded at or before it. Interpolation is OFF unless explicitly
 * requested, applies only to the continuous allele-frequency metric, and is always flagged.
 */
import type { SimulationFrame } from "../types";

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Modelled year shown after `elapsedS` seconds of (speed-adjusted) playback. Clamped to the run's span. */
export function visibleYear(elapsedS: number, playbackS: number, horizonYears: number, startYear = 0): number {
  if (!(playbackS > 0) || !Number.isFinite(elapsedS)) return startYear;
  const frac = clamp(elapsedS / playbackS, 0, 1);
  return startYear + frac * horizonYears;
}

/** Inverse of visibleYear: elapsed playback seconds at which `year` becomes visible. */
export function elapsedForYear(year: number, playbackS: number, horizonYears: number, startYear = 0): number {
  if (!(horizonYears > 0) || !(playbackS > 0)) return 0;
  return clamp((year - startYear) / horizonYears, 0, 1) * playbackS;
}

/** Index of the latest frame with simulated_years <= year; -1 when `year` precedes every frame. */
export function frameIndexAt(frames: ReadonlyArray<Pick<SimulationFrame, "simulated_years">>, year: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].simulated_years <= year) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export interface FrameLookup {
  index: number;
  frame: SimulationFrame | null;
  /** Allele frequency to display. Equals frame.allele_frequency unless `interpolated`. */
  alleleFrequency: number | null;
  /** True only when interpolation was explicitly enabled AND the value lies strictly between two frames. */
  interpolated: boolean;
}

export function frameAt(frames: readonly SimulationFrame[], year: number, opts: { interpolate?: boolean } = {}): FrameLookup {
  const index = frameIndexAt(frames, year);
  if (index < 0) return { index, frame: null, alleleFrequency: null, interpolated: false };
  const frame = frames[index];
  const next = frames[index + 1];
  if (opts.interpolate && next && !frame.extinct && !next.extinct && year > frame.simulated_years && next.simulated_years > frame.simulated_years) {
    const t = (year - frame.simulated_years) / (next.simulated_years - frame.simulated_years);
    return { index, frame, alleleFrequency: frame.allele_frequency + t * (next.allele_frequency - frame.allele_frequency), interpolated: true };
  }
  return { index, frame, alleleFrequency: frame.allele_frequency, interpolated: false };
}

export interface PlaybackSnapshot {
  elapsedS: number;
  playing: boolean;
  speed: number;
  ended: boolean;
  visibleYear: number;
}

export interface ClockDeps {
  /** Monotonic millisecond clock (performance.now). Injectable for tests. */
  now: () => number;
  /** Schedules the next tick; returns a cancel function. Injectable for tests. */
  schedule: (cb: (nowMs: number) => void) => () => void;
}

const browserDeps = (): ClockDeps => ({
  now: () => performance.now(),
  schedule: (cb) => {
    const id = requestAnimationFrame(cb);
    return () => cancelAnimationFrame(id);
  },
});

/**
 * Time-based playback (independent of frame rate). Pure state machine plus an rAF driver; all time comes from
 * `deps`, so tests can drive it with a fake clock. Advancing is `dt * speed`, never "one step per frame".
 */
export class PlaybackController {
  private elapsedS = 0;
  private playing = false;
  private speed: number = 1;
  private lastMs: number | null = null;
  private cancel: (() => void) | null = null;
  private listeners = new Set<(s: PlaybackSnapshot) => void>();

  constructor(
    private playbackS: number,
    private horizonYears: number,
    private startYear = 0,
    private deps: ClockDeps = browserDeps(),
  ) {
    if (!(playbackS > 0)) this.playbackS = 60;
  }

  configure(playbackS: number, horizonYears: number, startYear = 0) {
    this.playbackS = playbackS > 0 ? playbackS : 60;
    this.horizonYears = horizonYears;
    this.startYear = startYear;
    this.elapsedS = clamp(this.elapsedS, 0, this.playbackS);
    this.emit();
  }

  snapshot(): PlaybackSnapshot {
    return {
      elapsedS: this.elapsedS,
      playing: this.playing,
      speed: this.speed,
      ended: this.elapsedS >= this.playbackS,
      visibleYear: visibleYear(this.elapsedS, this.playbackS, this.horizonYears, this.startYear),
    };
  }

  subscribe(fn: (s: PlaybackSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const s = this.snapshot();
    this.listeners.forEach((l) => l(s));
  }

  play() {
    if (this.playing) return;
    if (this.elapsedS >= this.playbackS) this.elapsedS = 0; // play from the end restarts
    this.playing = true;
    this.lastMs = this.deps.now();
    this.loop();
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.advanceTo(this.deps.now());
    this.playing = false;
    this.lastMs = null;
    this.cancel?.();
    this.cancel = null;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  restart(autoplay = false) {
    this.elapsedS = 0;
    this.lastMs = this.playing ? this.deps.now() : null;
    this.emit();
    if (autoplay) this.play();
  }

  setSpeed(speed: number) {
    if (this.playing) this.advanceTo(this.deps.now()); // bank time at the old speed
    this.speed = speed > 0 ? speed : 1;
    this.emit();
  }

  seekYear(year: number) {
    this.elapsedS = elapsedForYear(year, this.playbackS, this.horizonYears, this.startYear);
    if (this.playing) this.lastMs = this.deps.now();
    this.emit();
  }

  seekElapsed(s: number) {
    this.elapsedS = clamp(s, 0, this.playbackS);
    if (this.playing) this.lastMs = this.deps.now();
    this.emit();
  }

  /** Document hidden: stop accumulating wall time without pausing, so there is no jump on return. */
  suspendWallClock() {
    if (this.playing) this.advanceTo(this.deps.now());
    this.lastMs = null;
  }
  resumeWallClock() {
    if (this.playing) this.lastMs = this.deps.now();
  }

  /** Public for tests: advance by the wall time elapsed up to `nowMs`. */
  tick(nowMs: number) {
    this.advanceTo(nowMs);
    this.emit();
  }

  dispose() {
    this.cancel?.();
    this.cancel = null;
    this.playing = false;
    this.listeners.clear();
  }

  private advanceTo(nowMs: number) {
    if (!this.playing || this.lastMs === null) return;
    const dt = Math.max(0, nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    this.elapsedS = Math.min(this.playbackS, this.elapsedS + dt * this.speed);
    if (this.elapsedS >= this.playbackS) {
      this.playing = false;
      this.lastMs = null;
      this.cancel?.();
      this.cancel = null;
    }
  }

  private loop() {
    this.cancel = this.deps.schedule((t) => {
      if (!this.playing) return;
      this.advanceTo(t);
      this.emit();
      if (this.playing) this.loop();
    });
  }
}
