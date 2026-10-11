import type { KeyboardEvent } from "react";
import { useAnatomySelection } from "../../v14/state/anatomySelection";
import {
  ABDOMEN, ARM_L, ARM_R, BLADDER, BRAIN, FACE, FOOT_L, FOOT_R, HAND_L, HAND_R, HEAD, HEART, KIDNEY_L, KIDNEY_R,
  LEG_L, LEG_R, LIVER, LUNG_L, LUNG_R, NECK, PELVIS, SPINE, STOMACH, THORAX,
} from "./ids";
import { NODE_BY_ID } from "./catalog";

interface Region {
  id: string;
  d?: string;
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
}

/**
 * Original labelled SVG (front view, +X = viewer's right = anatomical left).
 * Not traced from any third-party atlas.
 */
const REGIONS: Region[] = [
  { id: HEAD, cx: 100, cy: 28, rx: 18, ry: 20 },
  { id: FACE, cx: 100, cy: 34, rx: 12, ry: 10 },
  { id: NECK, cx: 100, cy: 52, rx: 8, ry: 7 },
  { id: THORAX, cx: 100, cy: 80, rx: 32, ry: 22 },
  { id: ABDOMEN, cx: 100, cy: 118, rx: 26, ry: 18 },
  { id: PELVIS, cx: 100, cy: 148, rx: 28, ry: 12 },
  { id: SPINE, cx: 100, cy: 100, rx: 6, ry: 48 },
  { id: ARM_L, d: "M132 64 C148 72 156 100 160 128 C162 140 166 152 168 160" },
  { id: ARM_R, d: "M68 64 C52 72 44 100 40 128 C38 140 34 152 32 160" },
  { id: HAND_L, cx: 170, cy: 172, rx: 8, ry: 12 },
  { id: HAND_R, cx: 30, cy: 172, rx: 8, ry: 12 },
  { id: LEG_L, d: "M116 160 C120 190 122 220 124 250" },
  { id: LEG_R, d: "M84 160 C80 190 78 220 76 250" },
  { id: FOOT_L, cx: 130, cy: 268, rx: 14, ry: 6 },
  { id: FOOT_R, cx: 70, cy: 268, rx: 14, ry: 6 },
  { id: BRAIN, cx: 100, cy: 24, rx: 12, ry: 8 },
  { id: HEART, cx: 108, cy: 78, rx: 7, ry: 8 },
  { id: LUNG_L, cx: 118, cy: 80, rx: 10, ry: 16 },
  { id: LUNG_R, cx: 82, cy: 80, rx: 10, ry: 16 },
  { id: LIVER, cx: 86, cy: 110, rx: 12, ry: 7 },
  { id: STOMACH, cx: 112, cy: 114, rx: 8, ry: 6 },
  { id: KIDNEY_L, cx: 118, cy: 128, rx: 5, ry: 7 },
  { id: KIDNEY_R, cx: 82, cy: 128, rx: 5, ry: 7 },
  { id: BLADDER, cx: 100, cy: 150, rx: 7, ry: 5 },
];

const ORDER = ["region", "organ"] as const;

function fillFor(id: string, hover: string | null, selected: string | null): string {
  if (id === selected) return "rgba(127,227,255,0.45)";
  if (id === hover) return "rgba(127,227,255,0.28)";
  return NODE_BY_ID[id]?.type === "organ" ? "rgba(154,212,255,0.16)" : "rgba(105,220,255,0.1)";
}

export function AnatomyFallback2D() {
  const hoverId = useAnatomySelection((s) => s.hoverId);
  const anatomyId = useAnatomySelection((s) => s.anatomyId);
  const label = NODE_BY_ID[hoverId ?? anatomyId ?? ""]?.label ?? "Body";
  const note = NODE_BY_ID[hoverId ?? anatomyId ?? ""]?.mesh_status === "unavailable"
    ? "3D mesh unavailable"
    : NODE_BY_ID[hoverId ?? anatomyId ?? ""]?.mesh_status === "approximate"
      ? "Approximate volume"
      : "2D atlas";

  const pick = (id: string) => useAnatomySelection.getState().selectAnatomy(id, { focus: true });

  return (
    <div
      className="pointer-events-auto flex h-full w-full flex-col items-center justify-center text-fg"
      data-testid="anatomy-fallback-2d"
    >
      <p className="mb-2 text-sm font-medium text-fg" data-testid="anatomy-label">
        {label}
        <span className="ml-2 text-2xs font-normal text-fg-3">{note}</span>
      </p>
      <svg
        viewBox="0 0 200 290"
        role="group"
        aria-label="Two-dimensional anatomy atlas"
        className="h-full max-h-[36rem] w-auto max-w-full"
      >
        <title>Anatomy atlas (SVG fallback)</title>
        {REGIONS.filter((r) => NODE_BY_ID[r.id]?.type !== "organ").map((r) => (
          <RegionShape key={r.id} region={r} hover={hoverId} selected={anatomyId} onPick={pick} />
        ))}
        {REGIONS.filter((r) => NODE_BY_ID[r.id]?.type === "organ").map((r) => (
          <RegionShape key={r.id} region={r} hover={hoverId} selected={anatomyId} onPick={pick} />
        ))}
      </svg>
      <span className="sr-only">{ORDER.join(" ")}</span>
    </div>
  );
}

function RegionShape({
  region,
  hover,
  selected,
  onPick,
}: {
  region: Region;
  hover: string | null;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const n = NODE_BY_ID[region.id];
  const title = n ? `${n.label}${n.laterality === "left" || n.laterality === "right" ? ` (${n.laterality})` : ""}` : region.id;
  const common = {
    fill: fillFor(region.id, hover, selected),
    stroke: region.id === selected || region.id === hover ? "rgb(127,227,255)" : "rgba(150,178,255,0.45)",
    strokeWidth: region.id === selected ? 2 : 1,
    className: "cursor-pointer",
    onMouseEnter: () => useAnatomySelection.getState().hover(region.id),
    onMouseLeave: () => useAnatomySelection.getState().hover(null),
    onClick: () => onPick(region.id),
    role: "button" as const,
    tabIndex: 0,
    "aria-label": title,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPick(region.id);
      }
    },
  };
  if (region.d) {
    return (
      <g>
        <title>{title}</title>
        <path d={region.d} strokeLinecap="round" {...common} fill="none" strokeWidth={14} />
      </g>
    );
  }
  return (
    <g>
      <title>{title}</title>
      <ellipse cx={region.cx} cy={region.cy} rx={region.rx} ry={region.ry} {...common} />
    </g>
  );
}
