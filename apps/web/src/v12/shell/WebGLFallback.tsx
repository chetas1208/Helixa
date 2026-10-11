import { useMemo } from "react";

const VIEW_W = 400;
const VIEW_H = 800;
const CX = VIEW_W / 2;
const RADIUS = 70;
const ROWS = 40;
const TURNS = 3.2;
const PERIOD_S = 11;
const Y0 = 50;
const Y1 = VIEW_H - 50;

// Decorative palette only (abstract strands: no nucleotide identity is implied).
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["rgb(127 227 255)", "rgb(90 134 255)"],
  ["rgb(134 120 255)", "rgb(189 150 255)"],
  ["rgb(90 134 255)", "rgb(127 227 255)"],
  ["rgb(189 150 255)", "rgb(134 120 255)"],
];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CSS = `
.v12fb-swing,.v12fb-swing-r,.v12fb-rung,.v12fb-depth,.v12fb-depth-r,.v12fb-star { animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
.v12fb-swing { animation-name: v12fb-swing; animation-duration: ${PERIOD_S / 2}s; animation-direction: alternate; }
.v12fb-swing-r { animation-name: v12fb-swing; animation-duration: ${PERIOD_S / 2}s; animation-direction: alternate-reverse; }
.v12fb-rung { animation-name: v12fb-rung; animation-duration: ${PERIOD_S / 2}s; animation-direction: alternate; }
.v12fb-depth,.v12fb-depth-r { animation-name: v12fb-depth; animation-duration: ${PERIOD_S}s; transform-box: fill-box; transform-origin: center; }
.v12fb-star { animation-name: v12fb-twinkle; }
@keyframes v12fb-swing { from { transform: translateX(${-RADIUS}px); } to { transform: translateX(${RADIUS}px); } }
@keyframes v12fb-rung { from { transform: scaleX(-1); } to { transform: scaleX(1); } }
@keyframes v12fb-depth { 0%,100% { transform: scale(.8); opacity:.7; } 25% { transform: scale(1.2); opacity:1; } 75% { transform: scale(.5); opacity:.35; } }
@keyframes v12fb-twinkle { 0%,100% { opacity:.12; } 50% { opacity:.7; } }
[data-motion="reduce"] .v12fb-swing,[data-motion="reduce"] .v12fb-swing-r,[data-motion="reduce"] .v12fb-rung,[data-motion="reduce"] .v12fb-depth,[data-motion="reduce"] .v12fb-depth-r,[data-motion="reduce"] .v12fb-star { animation-play-state: paused !important; animation-duration: ${PERIOD_S}s !important; animation-iteration-count: infinite !important; }
@media (prefers-reduced-motion: reduce) {
  .v12fb-swing,.v12fb-swing-r,.v12fb-rung,.v12fb-depth,.v12fb-depth-r,.v12fb-star { animation-play-state: paused !important; animation-duration: ${PERIOD_S}s !important; animation-iteration-count: infinite !important; }
}
`;

/**
 * 2D stand-in for the 3D scene when WebGL is unsupported, lost, or crashed. Pure CSS/SVG, no WebGL.
 * It is decorative (aria-hidden); App renders the explanatory notice separately.
 * `subdued` dims it for tabs where the helix is not the hero.
 */
export function WebGLFallback({ subdued = false }: { subdued?: boolean }) {
  const rows = useMemo(() => {
    const rand = mulberry32(0xd1a40d);
    return Array.from({ length: ROWS }, (_, i) => {
      const u = i / (ROWS - 1);
      const [left, right] = PAIRS[Math.floor(rand() * PAIRS.length)];
      return { y: Y0 + u * (Y1 - Y0), delay: -((u * TURNS) % 1) * PERIOD_S, left, right };
    });
  }, []);
  const stars = useMemo(() => {
    const rand = mulberry32(0x5eed42);
    return Array.from({ length: 56 }, () => ({ x: rand() * VIEW_W, y: rand() * VIEW_H, r: 0.4 + rand() * 0.9, delay: -rand() * 6, dur: 3 + rand() * 4 }));
  }, []);

  return (
    <div aria-hidden data-testid="webgl-fallback" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity: subdued ? 0.45 : 0.9, transition: "opacity 450ms var(--ease-out)" }}>
      <style>{CSS}</style>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="v12fb-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".2" stopColor="#fff" />
            <stop offset=".8" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="v12fb-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={VIEW_W} height={VIEW_H}>
            <rect width={VIEW_W} height={VIEW_H} fill="url(#v12fb-fade)" />
          </mask>
        </defs>
        {stars.map((s, i) => (
          <circle key={i} className="v12fb-star" cx={s.x} cy={s.y} r={s.r} fill={i % 4 === 0 ? "rgb(127 227 255)" : "rgb(176 188 210)"} style={{ animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }} />
        ))}
        <g mask="url(#v12fb-mask)">
          {rows.map((row, i) => (
            <g key={i} transform={`translate(${CX} ${row.y})`}>
              <line className="v12fb-rung" x1={-RADIUS} x2={RADIUS} y1="0" y2="0" stroke="rgb(150 178 255)" strokeOpacity=".28" strokeWidth="1.2" style={{ animationDelay: `${row.delay}s` }} />
              <g className="v12fb-swing" style={{ animationDelay: `${row.delay}s` }}>
                <g className="v12fb-depth" style={{ animationDelay: `${row.delay - PERIOD_S / 4}s` }}>
                  <circle r="9" fill={row.left} opacity=".16" />
                  <circle r="4" fill={row.left} />
                </g>
              </g>
              <g className="v12fb-swing-r" style={{ animationDelay: `${row.delay}s` }}>
                <g className="v12fb-depth-r" style={{ animationDelay: `${row.delay - PERIOD_S / 4 - PERIOD_S / 2}s` }}>
                  <circle r="9" fill={row.right} opacity=".16" />
                  <circle r="4" fill={row.right} />
                </g>
              </g>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
