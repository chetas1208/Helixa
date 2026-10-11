import type { PlaybackController, PlaybackSnapshot } from "./playbackClock";
import { SPEEDS, frameAt } from "./playbackClock";
import type { Simulation } from "../types";
import { fmtInt, fmtYears } from "./runData";
import { btn, chip, focusRing } from "./ui";

interface Props {
  controller: PlaybackController;
  snap: PlaybackSnapshot;
  sim: Simulation | null;
  playbackSeconds: number;
  interpolate: boolean;
  onInterpolate: (v: boolean) => void;
  reducedMotion: boolean;
}

export function Scrubber({ controller, snap, sim, playbackSeconds, interpolate, onInterpolate, reducedMotion }: Props) {
  const horizon = sim?.simulated_years ?? 0;
  const lookup = sim ? frameAt(sim.frames, snap.visibleYear, { interpolate }) : null;
  const f = lookup?.frame ?? null;
  const disabled = !sim;
  return (
    <div className="flex flex-col gap-2 p-3" role="group" aria-label="Playback">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${btn} min-w-[88px]`} onClick={() => controller.toggle()} disabled={disabled} aria-label={snap.playing ? "Pause playback" : snap.ended ? "Replay" : "Play playback"}>
          <span aria-hidden>{snap.playing ? "❚❚" : "▶"}</span> {snap.playing ? "Pause" : snap.ended ? "Replay" : "Play"}
        </button>
        <button type="button" className={btn} onClick={() => controller.restart()} disabled={disabled} aria-label="Restart from year 0">
          <span aria-hidden>↺</span> Restart
        </button>
        <div role="group" aria-label="Playback speed" className="flex gap-1">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={chip(snap.speed === s)} aria-pressed={snap.speed === s} disabled={disabled} onClick={() => controller.setSpeed(s)}>
              ×{s}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-200" data-testid="playback-readout">
          ~{playbackSeconds} s playback{snap.speed !== 1 ? ` at ×${snap.speed}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-right font-mono text-xs text-slate-200">0</span>
        <input
          type="range"
          aria-label="Modelled year"
          aria-valuetext={sim ? `${fmtYears(snap.visibleYear)} of ${fmtYears(horizon)}` : "No run"}
          min={0}
          max={horizon || 1}
          step={horizon ? Math.max(1, horizon / 2000) : 1}
          value={snap.visibleYear}
          disabled={disabled}
          onChange={(e) => controller.seekYear(Number(e.target.value))}
          className={`h-6 min-w-0 flex-1 accent-cyan-300 ${focusRing}`}
        />
        <span className="w-16 shrink-0 font-mono text-xs text-slate-200">{sim ? fmtYears(horizon) : "no run"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-200">
        {sim ? (
          <>
            <span>
              Year <span className="font-mono text-slate-50">{fmtYears(snap.visibleYear)}</span>
            </span>
            {f ? (
              <span data-testid="frame-readout">
                Latest recorded frame: gen <span className="font-mono">{fmtInt(f.generation)}</span> ({fmtYears(f.simulated_years)}), frequency <span className="font-mono">{(lookup!.alleleFrequency ?? 0).toFixed(3)}</span>
                {lookup!.interpolated ? " (interpolated, not a recorded generation)" : ""}, N <span className="font-mono">{fmtInt(f.population_size)}</span>
                {f.extinct ? " · extinct" : ""}
              </span>
            ) : (
              <span>No recorded frame yet at this year.</span>
            )}
            <label className="ml-auto flex items-center gap-1.5">
              <input type="checkbox" checked={interpolate} onChange={(e) => onInterpolate(e.target.checked)} className={`accent-cyan-300 ${focusRing}`} />
              Interpolate allele frequency between frames (flagged)
            </label>
          </>
        ) : (
          <span>Run a simulation to enable playback. Playback duration is separate from modelled time.</span>
        )}
        {reducedMotion && <span className="text-slate-300">Reduced motion: scene animation is minimal.</span>}
      </div>
    </div>
  );
}
