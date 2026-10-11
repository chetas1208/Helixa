import { useMemo } from "react";
import type { BaseChange, WindowDiffCell } from "./genomeModel";
import { useWidth } from "./useWidth";
import { focusRing } from "../simulation/ui";

const TINT: Record<string, string> = { A: "text-emerald-200", C: "text-sky-200", G: "text-amber-200", T: "text-rose-200" };
// Shape cue per nucleotide (in addition to the letter and hue).
const GLYPH: Record<string, string> = { A: "▲", C: "●", G: "◆", T: "■" };

interface Props {
  cells: WindowDiffCell[];
  outside: BaseChange[];
  selectedPosition: number | null;
  onPick: (position: number) => void;
  selectedLabel: string;
}

/** Baseline strip over selected strip, aligned by position, with a coordinate ruler. Changed bases: letter + shape + connector. */
export function DiffVisual({ cells, outside, selectedPosition, onPick, selectedLabel }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const perRow = width >= 880 ? 48 : width >= 520 ? 24 : 12;
  const chunks = useMemo(() => {
    const out: WindowDiffCell[][] = [];
    for (let i = 0; i < cells.length; i += perRow) out.push(cells.slice(i, i + perRow));
    return out;
  }, [cells, perRow]);
  const labelW = 64;

  return (
    <div ref={ref} className="min-w-0" role="group" aria-label="Baseline versus selected version, aligned by position">
      <div className="space-y-5 pt-1">
        {chunks.map((chunk) => (
          <div key={chunk[0].position} className="grid items-center gap-y-0 font-mono" style={{ gridTemplateColumns: `${labelW}px minmax(0,1fr)` }}>
            <span aria-hidden />
            <div className="grid" style={{ gridTemplateColumns: `repeat(${chunk.length}, minmax(0,1fr))` }} aria-hidden>
              {chunk.map((c) => (
                <span key={c.position} className="border-l border-white/10 pl-0.5 text-[10px] leading-4 text-slate-400">{c.position % 6 === 0 || c === chunk[0] ? c.position : " "}</span>
              ))}
            </div>

            <span className="text-[11px] text-slate-300">baseline</span>
            <div className="grid text-center text-[15px]" style={{ gridTemplateColumns: `repeat(${chunk.length}, minmax(0,1fr))` }}>
              {chunk.map((c) => (
                <span key={c.position} className={c.changed ? "mx-px rounded-[4px] border border-dashed border-slate-400/70 py-1 text-slate-200" : `py-1 ${TINT[c.ref] ?? "text-slate-200"} opacity-70`}>{c.ref}</span>
              ))}
            </div>

            <span aria-hidden />
            <div className="grid text-center text-[10px] leading-4 text-cyan-200" style={{ gridTemplateColumns: `repeat(${chunk.length}, minmax(0,1fr))` }} aria-hidden>
              {chunk.map((c) => (
                <span key={c.position} className="flex h-6 flex-col items-center justify-center">
                  {c.changed ? (
                    <>
                      <span className="h-2 w-px bg-cyan-300" />
                      <span>{GLYPH[c.edited] ?? ""}</span>
                    </>
                  ) : null}
                </span>
              ))}
            </div>

            <span className="text-[11px] text-slate-100">{selectedLabel}</span>
            <div className="grid text-center text-[15px]" style={{ gridTemplateColumns: `repeat(${chunk.length}, minmax(0,1fr))` }}>
              {chunk.map((c) =>
                c.changed ? (
                  <button
                    key={c.position}
                    type="button"
                    onClick={() => onPick(c.position)}
                    aria-label={`Position ${c.position}: ${c.ref} changed to ${c.edited}`}
                    aria-pressed={selectedPosition === c.position}
                    className={`mx-px rounded-[4px] border py-1 font-bold shadow-[0_0_10px_rgba(34,211,238,0.55)] ${focusRing} ${selectedPosition === c.position ? "border-cyan-100 bg-cyan-300/40 text-white" : "border-cyan-300/70 bg-cyan-400/20 text-cyan-50"}`}
                  >
                    {c.edited}
                  </button>
                ) : (
                  <span key={c.position} className={`py-1 ${TINT[c.edited] ?? "text-slate-200"}`}>{c.edited}</span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
      {cells.some((c) => c.changed) && (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Changed bases">
          {cells.filter((c) => c.changed).map((c) => (
            <li key={c.position}>
              <button type="button" onClick={() => onPick(c.position)} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-[13px] ${focusRing} ${selectedPosition === c.position ? "border-cyan-200 bg-cyan-300/20" : "border-white/15 bg-white/[0.04] hover:bg-white/[0.09]"}`}>
                <span className="text-slate-300">base {c.position}</span>
                <span className="text-slate-300">{c.ref}</span>
                <span aria-hidden>{"\u2192"}</span>
                <span className="font-bold text-cyan-50"><span aria-hidden className="text-cyan-200">{GLYPH[c.edited]}</span> {c.edited}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300" aria-label="Shape cues for changed bases">
        <span>Changed base shapes:</span>
        {(["A", "C", "G", "T"] as const).map((n) => (
          <span key={n} className="font-mono"><span aria-hidden className="text-cyan-200">{GLYPH[n]}</span> {n}</span>
        ))}
      </p>
      {outside.length > 0 && (
        <p className="mt-2 text-xs text-slate-200">Also changed outside this window: {outside.map((c) => `${c.position} ${c.from}→${c.to}`).join(", ")}.</p>
      )}
    </div>
  );
}
