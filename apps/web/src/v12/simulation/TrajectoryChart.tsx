import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Simulation } from "../types";
import type { Band } from "./runData";
import { fmtInt, fmtYears } from "./runData";
import { SERIES } from "./ui";

export interface ChartSeries {
  key: "a" | "b";
  label: string;
  sim: Simulation;
}

interface Props {
  series: ChartSeries[];
  band: Band | null;
  /** Modelled year of the playhead (throttled by the parent). Null hides it. */
  playheadYear: number | null;
}

const W = 380;
const H = 250;
const M = { l: 48, r: 66, t: 14, b: 32 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

/** Step-after path: a recorded frame holds until the next recorded frame (no implied interpolation). */
function stepPath(pts: Array<[number, number]>): string {
  if (!pts.length) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${pts[i][0].toFixed(1)} V${pts[i][1].toFixed(1)}`;
  return d;
}

export function TrajectoryChart({ series, band, playheadYear }: Props) {
  const [cursor, setCursor] = useState<number | null>(null);
  const descId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const primary = series[0].sim;
  const xMax = Math.max(...series.map((s) => s.sim.simulated_years), 1);
  const x = (years: number) => M.l + (years / xMax) * PW;
  const y = (p: number) => M.t + (1 - p) * PH;

  const paths = useMemo(
    () => series.map((s) => ({ ...s, d: stepPath(s.sim.frames.map((f) => [x(f.simulated_years), y(f.allele_frequency)] as [number, number])) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, xMax],
  );
  const bandPath = useMemo(() => {
    if (!band) return null;
    const top = band.years.map((yr, i) => `${i === 0 ? "M" : "L"}${x(yr).toFixed(1)},${y(band.max[i]).toFixed(1)}`).join(" ");
    const bot = band.years.map((_, i) => `L${x(band.years[band.years.length - 1 - i]).toFixed(1)},${y(band.min[band.years.length - 1 - i]).toFixed(1)}`).join(" ");
    return `${top} ${bot} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, xMax]);

  const extinctMarks = series
    .map((s) => ({ s, f: s.sim.frames.find((fr) => fr.extinct) }))
    .filter((e): e is { s: ChartSeries; f: NonNullable<typeof e.f> } => !!e.f);

  const nearest = (clientX: number): number | null => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return null;
    const px = ((clientX - box.left) / box.width) * W;
    const yr = ((px - M.l) / PW) * xMax;
    let best = 0;
    const fr = primary.frames;
    for (let i = 0; i < fr.length; i++) if (Math.abs(fr[i].simulated_years - yr) < Math.abs(fr[best].simulated_years - yr)) best = i;
    return best;
  };
  const onMove = (e: PointerEvent) => setCursor(nearest(e.clientX));
  const onKey = (e: KeyboardEvent) => {
    const n = primary.frames.length;
    if (e.key === "ArrowRight") setCursor((c) => Math.min(n - 1, (c ?? -1) + 1));
    else if (e.key === "ArrowLeft") setCursor((c) => Math.max(0, (c ?? 1) - 1));
    else if (e.key === "Home") setCursor(0);
    else if (e.key === "End") setCursor(n - 1);
    else if (e.key === "Escape") setCursor(null);
    else return;
    e.preventDefault();
  };

  const cf = cursor !== null ? primary.frames[cursor] : null;
  const yearTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * xMax);
  const label = `Allele frequency over modelled years, ${series.map((s) => `${s.label}: seed ${s.sim.seed}, frequency ${s.sim.frames[0].allele_frequency.toFixed(2)} to ${s.sim.frames[s.sim.frames.length - 1].allele_frequency.toFixed(2)}`).join("; ")}`;
  const desc = [
    `${primary.frames.length} recorded frames over ${fmtYears(xMax)}.`,
    ...extinctMarks.map(({ s, f }) => `${s.label} population extinct at ${fmtYears(f.simulated_years)}.`),
    band ? `Shaded band: min to max across ${band.seeds.length} real runs (seeds ${band.seeds.join(", ")}).` : "",
    "Full values are in the frames table below the chart.",
  ].filter(Boolean).join(" ");

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-[13px] font-semibold text-slate-100">Focal allele frequency over modelled years</figcaption>

      {(series.length > 1 || band) && (
        <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-200" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <svg width="26" height="10" aria-hidden><line x1="1" x2="25" y1="5" y2="5" stroke={SERIES[s.key]} strokeWidth="2.5" strokeDasharray={s.key === "b" ? "6 3" : undefined} /></svg>
              {s.label} (seed {s.sim.seed})
            </li>
          ))}
          {band && (
            <li className="flex items-center gap-1.5">
              <svg width="26" height="10" aria-hidden><rect x="1" y="1" width="24" height="8" fill={SERIES.a} fillOpacity="0.28" /></svg>
              range across {band.seeds.length} real runs (seeds {band.seeds.join(", ")})
            </li>
          )}
        </ul>
      )}

      <div ref={wrap} className="relative" onPointerMove={onMove} onPointerLeave={() => setCursor(null)}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          role="img"
          aria-label={label}
          aria-describedby={descId}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setCursor(null)}
        >
          <title>Focal allele frequency over modelled years</title>
          <desc id={descId}>{desc}</desc>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="#94a3b8" strokeOpacity="0.16" />
              <text x={M.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#cbd5e1">{t.toFixed(2)}</text>
            </g>
          ))}
          {yearTicks.map((t, i) => (
            <text key={i} x={x(t)} y={H - 10} textAnchor={i === 0 ? "start" : i === yearTicks.length - 1 ? "end" : "middle"} fontSize="11" fill="#cbd5e1">{fmtYears(t)}</text>
          ))}
          <text x={10} y={M.t + PH / 2} transform={`rotate(-90 10 ${M.t + PH / 2})`} textAnchor="middle" fontSize="11" fill="#cbd5e1">allele frequency</text>

          {bandPath && <path d={bandPath} fill={SERIES.a} fillOpacity="0.22" />}
          {extinctMarks.map(({ s, f }) => (
            <g key={s.key}>
              <rect x={x(f.simulated_years)} y={M.t} width={Math.max(0, M.l + PW - x(f.simulated_years))} height={PH} fill="#ef4444" fillOpacity="0.1" />
              <line x1={x(f.simulated_years)} x2={x(f.simulated_years)} y1={M.t} y2={M.t + PH} stroke="#fca5a5" strokeWidth="1.5" strokeDasharray="4 3" />
              <text x={x(f.simulated_years) + (f.simulated_years > xMax * 0.4 ? -4 : 4)} y={M.t + 12 + (s.key === "b" ? 14 : 0)} textAnchor={f.simulated_years > xMax * 0.4 ? "end" : "start"} fontSize="11" fill="#fecaca">{s.label} extinct at {fmtYears(f.simulated_years)}</text>
            </g>
          ))}
          {paths.map((p) => (
            <path key={p.key} d={p.d} fill="none" stroke={SERIES[p.key]} strokeWidth="2" strokeLinejoin="round" strokeDasharray={p.key === "b" ? "7 3" : undefined} />
          ))}
          {paths.map((p) => {
            const last = p.sim.frames[p.sim.frames.length - 1];
            return (
              <g key={`l${p.key}`}>
                <circle cx={x(last.simulated_years)} cy={y(last.allele_frequency)} r="4" fill={SERIES[p.key]} stroke="#05080f" strokeWidth="2" />
                <text x={x(last.simulated_years) + 8} y={y(last.allele_frequency) + (p.key === "b" ? 14 : 4)} fontSize="11" fill="#f1f5f9">{p.label} {last.allele_frequency.toFixed(2)}</text>
              </g>
            );
          })}
          {playheadYear !== null && (
            <g>
              <line x1={x(playheadYear)} x2={x(playheadYear)} y1={M.t} y2={M.t + PH} stroke="#67e8f9" strokeWidth="1.25" />
              <polygon points={`${x(playheadYear) - 4},${M.t - 1} ${x(playheadYear) + 4},${M.t - 1} ${x(playheadYear)},${M.t + 5}`} fill="#67e8f9" />
            </g>
          )}
          {cf && (
            <g>
              <line x1={x(cf.simulated_years)} x2={x(cf.simulated_years)} y1={M.t} y2={M.t + PH} stroke="#e2e8f0" strokeOpacity="0.55" strokeDasharray="2 3" />
              {series.map((s) => {
                const f = s.sim.frames[Math.min(cursor!, s.sim.frames.length - 1)];
                return <circle key={s.key} cx={x(f.simulated_years)} cy={y(f.allele_frequency)} r="5" fill={SERIES[s.key]} stroke="#f8fafc" strokeWidth="2" />;
              })}
            </g>
          )}
        </svg>
        {cf && (
          <div
            role="status"
            className="pointer-events-none absolute top-1 z-10 w-max max-w-[220px] rounded-md border border-white/20 bg-slate-950/95 px-2.5 py-1.5 text-xs text-slate-100 shadow-lg"
            style={{ left: `${Math.min(46, Math.max(2, (x(cf.simulated_years) / W) * 100 + 2))}%` }}
          >
            <div className="font-mono">{fmtYears(cf.simulated_years)} (gen {fmtInt(cf.generation)})</div>
            {series.map((s) => {
              const f = s.sim.frames[Math.min(cursor!, s.sim.frames.length - 1)];
              return (
                <div key={s.key}>
                  {s.label}: p = <span className="font-mono">{f.allele_frequency.toFixed(3)}</span>, N = <span className="font-mono">{fmtInt(f.population_size)}</span>
                  {f.extinct ? " (extinct)" : ""}
                </div>
              );
            })}
            <div className="text-slate-300">recorded frame, not interpolated</div>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-300">Recorded frames only, each held until the next. Hover or use arrow keys to read a frame.</p>
    </figure>
  );
}

/** Recorded frames as a table (the chart's text equivalent). */
export function FramesTable({ series }: { series: ChartSeries[] }) {
  const primary = series[0].sim;
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-white/10" tabIndex={0} aria-label="Frames table (scrollable)">
      <table className="w-full border-collapse text-left text-xs">
        <caption className="sr-only">Recorded frames for {series.map((s) => s.label).join(" and ")}</caption>
        <thead className="sticky top-0 bg-slate-950 text-slate-200">
          <tr>
            <th className="px-2 py-1.5 font-medium" scope="col">Generation</th>
            <th className="px-2 py-1.5 font-medium" scope="col">Modelled year</th>
            {series.map((s) => (
              <th key={s.key} className="px-2 py-1.5 font-medium" scope="col">{s.label} frequency</th>
            ))}
            <th className="px-2 py-1.5 font-medium" scope="col">{series[0].label} N</th>
            <th className="px-2 py-1.5 font-medium" scope="col">Extinct</th>
          </tr>
        </thead>
        <tbody className="font-mono text-slate-100">
          {primary.frames.map((f, i) => (
            <tr key={f.generation} className="border-t border-white/5">
              <td className="px-2 py-1">{fmtInt(f.generation)}</td>
              <td className="px-2 py-1">{fmtInt(f.simulated_years)}</td>
              {series.map((s) => (
                <td key={s.key} className="px-2 py-1">{s.sim.frames[i] && s.sim.frames[i].generation === f.generation ? s.sim.frames[i].allele_frequency.toFixed(4) : "n/a"}</td>
              ))}
              <td className="px-2 py-1">{fmtInt(f.population_size)}</td>
              <td className="px-2 py-1">{f.extinct ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
