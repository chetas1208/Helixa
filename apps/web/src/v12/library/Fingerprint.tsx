import { useId, useMemo } from "react";
import { BASE_COLOR, LIT_COLOR, fingerprintGeometry } from "./fingerprint";

interface Props {
  /** Real preview bases of a revision (1-based positions map to string index + 1). */
  preview: string;
  /** 1-based positions to light (edited or differing bases). */
  lit?: ReadonlySet<number>;
  size?: "thumb" | "large";
  /** Accessible description (what this drawing is). */
  label: string;
  /** Large mode: print the base letter under lit columns so colour is never the only cue. */
  letters?: boolean;
  className?: string;
}

const EMPTY: ReadonlySet<number> = new Set();

/** Deterministic double-helix fingerprint of a sequence window. Decorative-but-meaningful: exposed as an image with a text label. */
export function Fingerprint({ preview, lit = EMPTY, size = "thumb", label, letters = false, className = "" }: Props) {
  const uid = useId().replace(/:/g, "");
  const step = size === "thumb" ? 6 : 8.4;
  const height = size === "thumb" ? 60 : 104;
  const geo = useMemo(() => fingerprintGeometry(preview, lit, { step, height, padding: 8 }), [preview, lit, step, height]);
  const bandTop = 3;
  const bandH = height - 6;
  const strand = (key: "y1" | "y2") => geo.cells.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)} ${c[key].toFixed(1)}`).join(" ");
  const total = size === "thumb" ? 2.2 : 3;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${geo.width} ${height + (letters ? 14 : 0)}`}
      className={`block h-auto w-full ${className}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id={`glow-${uid}`} x="-60%" y="-40%" width="220%" height="180%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <linearGradient id={`fade-${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.15" />
          <stop offset="0.12" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="0.88" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.15" />
        </linearGradient>
        <mask id={`mask-${uid}`}>
          <rect x="0" y="0" width={geo.width} height={height} fill={`url(#fade-${uid})`} />
        </mask>
      </defs>

      <g mask={`url(#mask-${uid})`}>
        {/* lit columns: soft band behind the helix */}
        {geo.cells.filter((c) => c.lit).map((c) => (
          <g key={`lit-${c.index}`}>
            <rect x={c.x - step / 2} y={bandTop} width={step} height={bandH} rx={step / 2} fill={LIT_COLOR} opacity="0.13" />
            <ellipse cx={c.x} cy={height / 2} rx={step * 0.9} ry={height * 0.42} fill={LIT_COLOR} opacity="0.28" filter={`url(#glow-${uid})`} />
          </g>
        ))}
        {/* backbones */}
        <path d={strand("y1")} fill="none" stroke="#94a3b8" strokeOpacity="0.28" strokeWidth={size === "thumb" ? 1 : 1.4} strokeLinejoin="round" />
        <path d={strand("y2")} fill="none" stroke="#94a3b8" strokeOpacity="0.28" strokeWidth={size === "thumb" ? 1 : 1.4} strokeLinejoin="round" />
        {/* base pairs: half rung per strand, coloured by the real base and its complement */}
        {geo.cells.map((c) => {
          const midY = (c.y1 + c.y2) / 2;
          const op = (0.3 + 0.55 * c.span) * (c.lit ? 1.3 : 1);
          const w = (c.lit ? total + 0.9 : total) * (0.7 + 0.3 * c.span);
          return (
            <g key={c.index} opacity={Math.min(1, op)}>
              <line x1={c.x} y1={c.y1} x2={c.x} y2={midY} stroke={BASE_COLOR[c.base]} strokeWidth={w} strokeLinecap="round" />
              <line x1={c.x} y1={midY} x2={c.x} y2={c.y2} stroke={BASE_COLOR[c.complement]} strokeWidth={w} strokeLinecap="round" />
            </g>
          );
        })}
        {/* nodes: the strand in front is larger and brighter */}
        {geo.cells.map((c) => (
          <g key={`n-${c.index}`}>
            <circle cx={c.x} cy={c.y1} r={(size === "thumb" ? 1.5 : 2.2) + (c.depth > 0 ? 0.9 : 0) * (size === "thumb" ? 1 : 1.3)} fill={BASE_COLOR[c.base]} opacity={c.depth > 0 ? 1 : 0.55} />
            <circle cx={c.x} cy={c.y2} r={(size === "thumb" ? 1.5 : 2.2) + (c.depth < 0 ? 0.9 : 0) * (size === "thumb" ? 1 : 1.3)} fill={BASE_COLOR[c.complement]} opacity={c.depth < 0 ? 1 : 0.55} />
          </g>
        ))}
        {/* lit markers: ring on both nodes plus a tick above the helix */}
        {geo.cells.filter((c) => c.lit).map((c) => (
          <g key={`m-${c.index}`}>
            <circle cx={c.x} cy={c.y1} r={size === "thumb" ? 3.4 : 5} fill="none" stroke={LIT_COLOR} strokeWidth="1.2" />
            <circle cx={c.x} cy={c.y2} r={size === "thumb" ? 3.4 : 5} fill="none" stroke={LIT_COLOR} strokeWidth="1.2" />
            <path d={`M${c.x - 2.6} 2.2 L${c.x + 2.6} 2.2 L${c.x} 6.2 Z`} fill={LIT_COLOR} />
          </g>
        ))}
      </g>
      {letters &&
        geo.cells.filter((c) => c.lit).map((c) => (
          <text key={`t-${c.index}`} x={c.x} y={height + 11} textAnchor="middle" fontSize="10" fontFamily="JetBrains Mono, monospace" fill={LIT_COLOR}>
            {c.base}
          </text>
        ))}
    </svg>
  );
}
