import { EvidenceBadge } from "../design/EvidenceBadge";
import { SERIES } from "./ui";

// Hand-written teaching curves. NOT produced by any engine, NOT live, NOT tied to any genome.
const EXAMPLE: number[][] = [
  [0.5, 0.56, 0.5, 0.58, 0.66, 0.6, 0.72, 0.8, 0.9, 1],
  [0.5, 0.44, 0.48, 0.4, 0.34, 0.36, 0.22, 0.14, 0.05, 0],
  [0.5, 0.5, 0.54, 0.52, 0.46, 0.5, 0.55, 0.47, 0.52, 0.5],
];

/** Clearly STATIC explanatory illustration shown when the engine cannot be reached. Never styled as live output. */
export function StaticExample() {
  const W = 320;
  const H = 130;
  const px = (i: number) => 28 + (i / 9) * (W - 40);
  const py = (p: number) => 8 + (1 - p) * (H - 24);
  return (
    <figure className="m-0 rounded-md border border-dashed border-amber-300/40 bg-amber-400/[0.06] p-3" data-testid="static-example">
      <figcaption className="mb-2 flex flex-wrap items-center gap-2">
        <EvidenceBadge kind="HYPOTHESIS" label="Static explanatory example" />
        <span className="text-xs font-medium text-amber-100">Not live. Not computed by this app.</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Static illustration: three hypothetical allele frequency paths under random drift, one fixing at 1, one lost at 0, one wandering near 0.5">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1="28" x2={W - 12} y1={py(t)} y2={py(t)} stroke="#94a3b8" strokeOpacity="0.2" />
            <text x="22" y={py(t) + 4} textAnchor="end" fontSize="10" fill="#cbd5e1">{t}</text>
          </g>
        ))}
        {EXAMPLE.map((row, k) => (
          <path key={k} d={row.map((p, i) => `${i ? "L" : "M"}${px(i)},${py(p)}`).join(" ")} fill="none" stroke={[SERIES.a, SERIES.b, SERIES.c][k]} strokeWidth="2" strokeDasharray={["", "6 3", "2 3"][k]} />
        ))}
        <text x={W - 12} y={py(1) - 2} textAnchor="end" fontSize="10" fill="#f1f5f9">fixed</text>
        <text x={W - 12} y={py(0) - 4} textAnchor="end" fontSize="10" fill="#f1f5f9">lost</text>
      </svg>
      <p className="mt-2 text-xs leading-relaxed text-slate-200">
        In a small population, random sampling of parents (genetic drift) can push an allele toward loss or fixation even with no selection. Real runs appear here when the simulation engine is reachable.
      </p>
    </figure>
  );
}
