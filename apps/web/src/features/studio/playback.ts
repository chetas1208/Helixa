/** Map a 60-second playback clock onto stored simulation frames. */

export const DEFAULT_PLAYBACK_MS = 60_000;

export interface PlaybackSample {
  index: number;
  next: number;
  /** 0 at the stored frame, approaching 1 at the next stored frame. */
  fraction: number;
  /** True when the clock sits between stored generations. Those points are not extra observations. */
  interpolated: boolean;
}

export function playbackSample(elapsedMs: number, durationMs: number, frameCount: number): PlaybackSample {
  if (frameCount <= 1 || durationMs <= 0) {
    return { index: 0, next: 0, fraction: 0, interpolated: false };
  }
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const scaled = t * (frameCount - 1);
  const index = Math.min(frameCount - 1, Math.floor(scaled));
  const fraction = scaled - index;
  const next = fraction === 0 ? index : Math.min(frameCount - 1, index + 1);
  return { index, next, fraction, interpolated: fraction > 0 && next !== index };
}
