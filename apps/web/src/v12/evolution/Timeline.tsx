import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { eventLabel } from "./genomeModel";
import type { GenomeEvent, GenomeTimeline } from "./genomeModel";
import { stepTone } from "./harnessModel";
import type { HarnessRecord } from "./harnessModel";
import { useWidth } from "./useWidth";

const PAD_X = 72;
const R = 13;
const MIN_STEP = 104;
const MAX_STEP = 260;
const ROW_GAP = 60;

export interface LNode {
  id: string;
  x: number;
  y: number;
  depth: number;
  row: number;
}
export interface LEdge {
  from: string;
  to: string;
}

export interface RowLabel {
  row: number;
  firstId: string;
  name: string;
  isCurrentWs: boolean;
}

/**
 * Pure layout: x by distance from the baseline. Rows: one per workspace when the lineage spans several
 * (ordered by where each workspace starts, so the source sits above its branches); otherwise one per branch.
 */
export function layoutGenome(timeline: GenomeTimeline, currentWs?: string | null): { nodes: LNode[]; edges: LEdge[]; maxDepth: number; rows: number; rowLabels: RowLabel[] } {
  const depth = new Map<string, number>();
  const visit = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const e = timeline.events.get(id);
    const d = e && e.parentId && timeline.events.has(e.parentId) ? visit(e.parentId, seen) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const id of timeline.events.keys()) visit(id);
  const row = new Map<string, number>();
  const rowLabels: RowLabel[] = [];
  const events = [...timeline.events.values()];
  const wsOf = (e: GenomeEvent) => e.node.workspaceId ?? (e.node.virtual ? undefined : "");
  const wsIds = [...new Set(events.map(wsOf).filter((w): w is string => !!w))];
  if (wsIds.length > 1) {
    const start = (ws: string) => Math.min(...events.filter((e) => wsOf(e) === ws).map((e) => depth.get(e.id)!));
    const ordered = [...wsIds].sort((a, b) => start(a) - start(b) || a.localeCompare(b));
    for (const e of events) row.set(e.id, Math.max(0, ordered.indexOf(wsOf(e) ?? ordered[0])));
    ordered.forEach((ws, r) => {
      const first = events.filter((e) => wsOf(e) === ws).sort((a, b) => depth.get(a.id)! - depth.get(b.id)!)[0];
      rowLabels.push({ row: r, firstId: first.id, name: first.node.workspaceName ?? ws, isCurrentWs: ws === currentWs });
    });
  } else {
    timeline.branches.forEach((b, bi) => b.path.forEach((id) => !row.has(id) && row.set(id, bi)));
    for (const id of timeline.events.keys()) if (!row.has(id)) row.set(id, 0);
  }
  const nodes: LNode[] = [...timeline.events.keys()].map((id) => ({ id, x: depth.get(id)!, y: row.get(id)!, depth: depth.get(id)!, row: row.get(id)! }));
  const edges: LEdge[] = [];
  for (const e of timeline.events.values()) if (e.parentId && timeline.events.has(e.parentId)) edges.push({ from: e.parentId, to: e.id });
  return { nodes, edges, maxDepth: Math.max(0, ...nodes.map((n) => n.depth)), rows: Math.max(1, ...nodes.map((n) => n.row + 1)), rowLabels };
}

const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
const fmtTime = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
};

interface Props {
  timeline: GenomeTimeline;
  selectedGenomeId: string;
  onSelectGenome: (id: string) => void;
  harnesses: HarnessRecord[];
  harnessLoading: boolean;
  harnessError: string | null;
  selectedHarnessId: string | null;
  focusLane: "genome" | "harness";
  onSelectHarness: (id: string) => void;
  reduced: boolean;
  currentWorkspaceId?: string | null;
}

type Tip = { x: number; y: number; title: string; lines: string[] } | null;

export function Timeline(p: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>(900);
  const [tip, setTip] = useState<Tip>(null);
  const refs = useRef(new Map<string, SVGGElement>());

  const g = useMemo(() => layoutGenome(p.timeline, p.currentWorkspaceId), [p.timeline, p.currentWorkspaceId]);
  const nCols = Math.max(g.maxDepth + (p.timeline.baselineOnly ? 1 : 0), p.harnesses.length - 1, 1);
  const step = Math.max(MIN_STEP, Math.min(MAX_STEP, (width - PAD_X * 2) / nCols));
  const svgW = Math.max(width, PAD_X * 2 + step * nCols);
  const offX = Math.max(0, (svgW - (PAD_X * 2 + step * nCols)) / 2);
  const gx = (d: number) => PAD_X + offX + d * step;
  const genomeRows = g.rows;
  const GENOME_Y = g.rowLabels.length ? 74 : 66;
  const narrow = width < 640;
  const midX = Math.min(svgW, width) / 2;
  const lane1H = GENOME_Y + (genomeRows - 1) * ROW_GAP + 54;
  const harnessY0 = lane1H + 40;
  const harnessY = harnessY0 + 40;
  const svgH = harnessY + 56;
  const pos = new Map(g.nodes.map((n) => [n.id, { x: gx(n.x), y: GENOME_Y + n.y * ROW_GAP }]));

  const order = [...g.nodes].sort((a, b) => a.x - b.x || a.y - b.y).map((n) => n.id);
  const hOrder = p.harnesses.map((h) => h.version_id);
  const hpos = new Map(p.harnesses.map((h, i) => [h.version_id, { x: gx(i), y: harnessY }]));

  // Tracks link only where ids truly match (genome revision's recorded harness id === harness version id).
  const links: Array<{ genomeId: string; harnessId: string }> = [];
  for (const e of p.timeline.events.values()) {
    const hid = e.node.harnessVersionId;
    if (hid && hpos.has(hid)) links.push({ genomeId: e.id, harnessId: hid });
  }

  const focus = (id: string) => refs.current.get(id)?.focus();
  const onKey = (list: string[], cur: string, select: (id: string) => void) => (e: KeyboardEvent) => {
    const i = list.indexOf(cur);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = Math.min(list.length - 1, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = Math.max(0, i - 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = list.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      select(cur);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    if (n >= 0 && list[n]) {
      select(list[n]);
      focus(list[n]);
    }
  };

  const anim = p.reduced ? "" : "transition-transform duration-200 ease-out";
  const showTip = (x: number, y: number, title: string, lines: string[]) => setTip({ x, y, title, lines });

  const genomeNode = (e: GenomeEvent) => {
    const { x, y } = pos.get(e.id)!;
    const sel = e.id === p.selectedGenomeId;
    const label = eventLabel(e);
    const when = fmtTime(e.node.createdAt);
    const otherWs = !!(e.node.workspaceId && p.currentWorkspaceId && e.node.workspaceId !== p.currentWorkspaceId);
    const rovingStop = p.focusLane === "genome" ? sel : p.selectedGenomeId === e.id;
    return (
      <g
        key={e.id}
        ref={(el) => {
          if (el) refs.current.set(e.id, el);
        }}
        role="button"
        tabIndex={rovingStop ? 0 : -1}
        aria-label={`${label}${e.isCurrent ? ", current version" : ""}${e.isBaseline ? ", baseline anchor" : ""}${otherWs ? `, stored in workspace ${e.node.workspaceName}` : ""}`}
        aria-current={sel ? "step" : undefined}
        className="cursor-pointer outline-none [&:focus-visible_.focus-ring]:opacity-100"
        onClick={() => p.onSelectGenome(e.id)}
        onKeyDown={onKey(order, e.id, p.onSelectGenome)}
        onPointerEnter={() =>
          showTip(x, y, label, [
            e.node.virtual ? "Unedited reference (not a stored revision)" : e.id,
            ...(e.node.workspaceName ? [`workspace: ${e.node.workspaceName}`] : []),
            when ?? "time not provided by the API",
            `${e.node.editCount} edit${e.node.editCount === 1 ? "" : "s"} in total`,
          ])
        }
        onPointerLeave={() => setTip(null)}
        onFocus={() => showTip(x, y, label, [e.node.virtual ? "Unedited reference" : e.id])}
        onBlur={() => setTip(null)}
      >
        <circle cx={x} cy={y} r={R + 11} fill="transparent" />
        <circle className="focus-ring opacity-0" cx={x} cy={y} r={R + 8} fill="none" stroke="#67e8f9" strokeWidth="2" strokeDasharray="3 3" />
        <g className={anim} style={{ transformOrigin: `${x}px ${y}px`, transform: sel ? "scale(1.22)" : "scale(1)" }}>
          {sel && <circle cx={x} cy={y} r={R + 6} fill="#22d3ee" fillOpacity="0.16" />}
          {e.isBaseline ? (
            <rect x={x - R * 0.8} y={y - R * 0.8} width={R * 1.6} height={R * 1.6} transform={`rotate(45 ${x} ${y})`} fill="#0c4a6e" stroke="#7dd3fc" strokeWidth="2.2" strokeDasharray={otherWs ? "4 3" : undefined} />
          ) : (
            <circle cx={x} cy={y} r={R} fill={e.isCurrent ? "#064e3b" : "#083344"} stroke={e.isCurrent ? "#6ee7b7" : "#67e8f9"} strokeWidth="2.2" strokeDasharray={otherWs ? "4 3" : undefined} />
          )}
          {e.isCurrent && <circle cx={x} cy={y} r={R + 5} fill="none" stroke="#6ee7b7" strokeWidth="1.5" />}
          {e.isBranchPoint && e.deltaKnown && e.delta.length === 0 ? (
            <path d={`M${x - 4},${y + 6} V${y - 6} M${x - 4},${y + 1} C${x - 4},${y - 2} ${x + 4},${y - 1} ${x + 4},${y - 6}`} fill="none" stroke="#ecfeff" strokeWidth="1.8" strokeLinecap="round" style={{ pointerEvents: "none" }} />
          ) : (
            !e.isBaseline && <text x={x} y={y + 4.5} textAnchor="middle" fontSize="12" fontWeight="700" fill="#ecfeff" style={{ pointerEvents: "none" }}>{e.deltaKnown && e.delta.length ? e.delta.length : e.addedCount ?? ""}</text>
          )}
        </g>
        <text x={x} y={y + R + 22} textAnchor="middle" fontSize="12.5" fontWeight={sel ? 700 : 500} fill="#f1f5f9" style={{ pointerEvents: "none" }}>{label.length > 22 ? `${label.slice(0, 21)}…` : label}</text>
        <text x={x} y={y + R + 37} textAnchor="middle" fontSize="10.5" fill="#cbd5e1" fontFamily="JetBrains Mono, monospace" style={{ pointerEvents: "none" }}>
          {e.isCurrent ? "current" : e.isBaseline ? (e.node.virtual ? "reference" : "baseline") : shortId(e.id)}
        </text>
      </g>
    );
  };

  const harnessNode = (h: HarnessRecord) => {
    const { x, y } = hpos.get(h.version_id)!;
    const sel = p.focusLane === "harness" && h.version_id === p.selectedHarnessId;
    const tone = stepTone(h.status);
    const stroke = tone === "rejected" ? "#fca5a5" : tone === "accepted" ? "#6ee7b7" : tone === "baseline" ? "#7dd3fc" : "#fcd34d";
    const fill = tone === "rejected" ? "#450a0a" : tone === "accepted" ? "#064e3b" : tone === "baseline" ? "#0c4a6e" : "#451a03";
    const roving = h.version_id === (p.selectedHarnessId ?? hOrder[hOrder.length - 1]);
    return (
      <g
        key={h.version_id}
        ref={(el) => {
          if (el) refs.current.set(`h:${h.version_id}`, el);
        }}
        role="button"
        tabIndex={roving ? 0 : -1}
        aria-label={`Harness ${h.version_id}, status ${h.status}${tone === "rejected" ? " (rejected or failed)" : ""}`}
        aria-current={sel ? "step" : undefined}
        className="cursor-pointer outline-none [&:focus-visible_.focus-ring]:opacity-100"
        onClick={() => p.onSelectHarness(h.version_id)}
        onKeyDown={(ev) => {
          const i = hOrder.indexOf(h.version_id);
          const n = ev.key === "ArrowRight" ? i + 1 : ev.key === "ArrowLeft" ? i - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? hOrder.length - 1 : null;
          if (ev.key === "Enter" || ev.key === " ") {
            p.onSelectHarness(h.version_id);
            ev.preventDefault();
          } else if (n !== null && n >= 0 && n < hOrder.length) {
            ev.preventDefault();
            p.onSelectHarness(hOrder[n]);
            refs.current.get(`h:${hOrder[n]}`)?.focus();
          }
        }}
        onPointerEnter={() => showTip(x, y, h.version_id, [`Status: ${h.status}`, fmtTime(h.created_at) ?? "time not recorded", h.parent_version_id ? `from ${h.parent_version_id}` : "root version"])}
        onPointerLeave={() => setTip(null)}
        onFocus={() => showTip(x, y, h.version_id, [`Status: ${h.status}`])}
        onBlur={() => setTip(null)}
      >
        <circle cx={x} cy={y} r={R + 11} fill="transparent" />
        <circle className="focus-ring opacity-0" cx={x} cy={y} r={R + 8} fill="none" stroke="#67e8f9" strokeWidth="2" strokeDasharray="3 3" />
        <g className={anim} style={{ transformOrigin: `${x}px ${y}px`, transform: sel ? "scale(1.22)" : "scale(1)" }}>
          {sel && <circle cx={x} cy={y} r={R + 6} fill="#22d3ee" fillOpacity="0.16" />}
          {tone === "baseline" && <rect x={x - R * 0.8} y={y - R * 0.8} width={R * 1.6} height={R * 1.6} transform={`rotate(45 ${x} ${y})`} fill={fill} stroke={stroke} strokeWidth="2.2" />}
          {tone === "accepted" && <circle cx={x} cy={y} r={R} fill={fill} stroke={stroke} strokeWidth="2.2" />}
          {tone === "rejected" && <rect x={x - R * 0.9} y={y - R * 0.9} width={R * 1.8} height={R * 1.8} rx="3" fill={fill} stroke={stroke} strokeWidth="2.2" />}
          {tone === "pending" && <polygon points={`${x},${y - R - 1} ${x + R + 1},${y + R * 0.8} ${x - R - 1},${y + R * 0.8}`} fill={fill} stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" />}
          <text x={x} y={y + 4.5} textAnchor="middle" fontSize="12" fontWeight="700" fill="#f8fafc" style={{ pointerEvents: "none" }}>{tone === "accepted" ? "✓" : tone === "rejected" ? "✕" : tone === "pending" ? "?" : ""}</text>
        </g>
        <text x={x} y={y + R + 22} textAnchor="middle" fontSize="12.5" fontWeight={sel ? 700 : 500} fill="#f1f5f9" style={{ pointerEvents: "none" }}>{h.version_id.length > 20 ? `${h.version_id.slice(0, 19)}…` : h.version_id}</text>
        <text x={x} y={y + R + 37} textAnchor="middle" fontSize="10.5" fill={tone === "rejected" ? "#fecaca" : "#cbd5e1"} style={{ pointerEvents: "none" }}>{tone === "rejected" ? "rejected / failed" : h.status.toLowerCase()}</text>
      </g>
    );
  };

  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const x1 = a.x + R;
    const x2 = b.x - R;
    const mx = (x1 + x2) / 2;
    return a.y === b.y ? `M${x1},${a.y} L${x2},${b.y}` : `M${x1},${a.y} C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`;
  };

  return (
    <div ref={wrapRef} className="relative min-w-0 overflow-x-auto overflow-y-hidden" data-testid="timeline">
      <svg width={svgW} height={svgH} role="group" aria-label="Two-lane timeline: genome versions above, agent harness versions below" className="block">
        <defs>
          <linearGradient id="lane-g" x1="0" x2="1">
            <stop offset="0" stopColor="#0e7490" stopOpacity="0.18" />
            <stop offset="1" stopColor="#0e7490" stopOpacity="0.03" />
          </linearGradient>
          <linearGradient id="lane-h" x1="0" x2="1">
            <stop offset="0" stopColor="#6d28d9" stopOpacity="0.2" />
            <stop offset="1" stopColor="#6d28d9" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* Lane 1 */}
        <rect x="4" y="6" width={svgW - 8} height={lane1H} rx="12" fill="url(#lane-g)" stroke="#67e8f9" strokeOpacity="0.18" />
        <text x="20" y="26" fontSize="13" fontWeight="600" fill="#e2e8f0">Genome versions</text>
        {!narrow && (
          <text x="146" y="26" fontSize="11.5" fill="#cbd5e1">
            {g.rowLabels.length ? "in-silico sequence changes; branches are joined by their recorded parent revision id" : "in-silico sequence changes saved in this workspace"}
          </text>
        )}
        {g.edges.map((e) => {
          const fork = p.timeline.events.get(e.to)?.isBranchPoint;
          return <path key={`${e.from}-${e.to}`} d={curve(pos.get(e.from)!, pos.get(e.to)!)} fill="none" stroke={fork ? "#a5b4fc" : "#67e8f9"} strokeOpacity={fork ? 0.8 : 0.55} strokeWidth="2" />;
        })}
        {g.rowLabels.map((l) => {
          const a = pos.get(l.firstId);
          if (!a) return null;
          return (
            <text key={l.row} x={a.x - R} y={a.y - R - 13} fontSize="11.5" fontWeight={l.isCurrentWs ? 600 : 400} fill={l.isCurrentWs ? "#a5f3fc" : "#cbd5e1"} style={{ pointerEvents: "none" }}>
              {l.name.length > 30 ? `${l.name.slice(0, 29)}…` : l.name}
              {l.isCurrentWs ? " · this workspace" : " · other workspace"}
            </text>
          );
        })}
        {p.timeline.baselineOnly && (
          <g aria-hidden>
            <path d={`M${gx(0) + R},${GENOME_Y} L${gx(1) - R},${GENOME_Y}`} stroke="#94a3b8" strokeOpacity="0.5" strokeDasharray="4 5" strokeWidth="2" />
            <circle cx={gx(1)} cy={GENOME_Y} r={R} fill="none" stroke="#94a3b8" strokeOpacity="0.5" strokeDasharray="4 4" strokeWidth="2" />
            <text x={gx(1)} y={GENOME_Y + R + 22} textAnchor="middle" fontSize="12" fill="#cbd5e1">next saved version</text>
          </g>
        )}
        {[...p.timeline.events.values()].map(genomeNode)}

        {/* Lane 2 */}
        <rect x="4" y={harnessY0 - 12} width={svgW - 8} height={svgH - harnessY0 + 6} rx="12" fill="url(#lane-h)" stroke="#a78bfa" strokeOpacity="0.2" />
        <text x="20" y={harnessY0 + 8} fontSize="13" fontWeight="600" fill="#e2e8f0">Agent harness</text>
        <text x="118" y={harnessY0 + 8} fontSize="11.5" fill="#cbd5e1">{narrow ? "not biology" : "how the analysis agent's strategy changed; not biology"}</text>
        {p.harnessLoading && <text x={PAD_X} y={harnessY + 4} fontSize="12.5" fill="#cbd5e1">Loading harness versions...</text>}
        {p.harnessError && <text x={PAD_X} y={harnessY + 4} fontSize="12.5" fill="#fecaca">Harness history unavailable: {p.harnessError.slice(0, 80)}</text>}
        {!p.harnessLoading && !p.harnessError && p.harnesses.length === 0 && <text x={PAD_X} y={harnessY + 4} fontSize="12.5" fill="#cbd5e1">No harness versions recorded.</text>}
        {p.harnesses.map((h) => {
          const parent = h.parent_version_id ? hpos.get(h.parent_version_id) : undefined;
          return parent ? <path key={`e-${h.version_id}`} d={curve(parent, hpos.get(h.version_id)!)} fill="none" stroke="#c4b5fd" strokeOpacity="0.6" strokeWidth="2" /> : null;
        })}
        {p.harnesses.map(harnessNode)}

        {/* Cross-lane link: only where ids truly match */}
        {links.map((l) => {
          const a = pos.get(l.genomeId)!;
          const b = hpos.get(l.harnessId)!;
          return <path key={`${l.genomeId}-${l.harnessId}`} d={`M${a.x},${a.y + R + 42} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y - R - 8}`} fill="none" stroke="#e9d5ff" strokeWidth="1.6" strokeDasharray="2 5" strokeLinecap="round" />;
        })}
        {links.length === 0 && p.harnesses.length > 0 && (
          <g data-testid="no-link-marker">
            {!narrow && (
              <>
                <line x1={midX - 290} x2={midX - 150} y1={lane1H + 17} y2={lane1H + 17} stroke="#94a3b8" strokeOpacity="0.45" strokeDasharray="2 5" />
                <line x1={midX + 150} x2={midX + 290} y1={lane1H + 17} y2={lane1H + 17} stroke="#94a3b8" strokeOpacity="0.45" strokeDasharray="2 5" />
              </>
            )}
            <text x={midX} y={lane1H + 21} textAnchor="middle" fontSize="11.5" fill="#cbd5e1">{narrow ? "✕ no recorded link (ids differ)" : "✕ no recorded link between the lanes (ids differ)"}</text>
          </g>
        )}
      </svg>
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-[16rem] rounded-md border border-white/20 bg-slate-950/95 px-2.5 py-1.5 text-xs text-slate-100 shadow-lg"
          style={{ left: Math.max(4, Math.min(svgW - 250, tip.x - 100)), top: Math.max(2, tip.y - 78) }}
        >
          <div className="font-semibold">{tip.title}</div>
          {tip.lines.map((l, i) => (
            <div key={i} className="break-all font-mono text-[11px] text-slate-300">{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}
