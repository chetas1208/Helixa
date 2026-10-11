import type { ReactNode } from "react";
import type { EvidenceKind } from "../types";

export interface EvidenceMeta {
  label: string;
  hint: string;
  /** Tailwind classes: border + text + faint fill. Colour never stands alone: see `glyph`. */
  cls: string;
  /** CSS colour (rgb channel var) for charts / SVG that need the same role colour. */
  color: string;
}

/**
 * Evidence-status semantics (see docs/frontend/V12_DESIGN_SYSTEM.md):
 * every claim carries exactly one kind; the kind is encoded by colour AND glyph AND text.
 */
export const EVIDENCE_META: Record<EvidenceKind, EvidenceMeta> = {
  REFERENCE: {
    label: "Observed reference",
    hint: "Read directly from the loaded reference sequence.",
    cls: "border-ev-reference/45 text-ev-reference bg-ev-reference/10",
    color: "rgb(var(--ev-reference))",
  },
  VALIDATED: {
    label: "Validated computation",
    hint: "Produced by a deterministic check with a recorded receipt.",
    cls: "border-ev-validated/45 text-ev-validated bg-ev-validated/10",
    color: "rgb(var(--ev-validated))",
  },
  SIMULATED: {
    label: "Simulation outcome",
    hint: "Output of a stated stochastic model, not an observation.",
    cls: "border-ev-simulated/45 text-ev-simulated bg-ev-simulated/10",
    color: "rgb(var(--ev-simulated))",
  },
  HYPOTHESIS: {
    label: "Hypothesis",
    hint: "A proposal or illustration. Not validated.",
    cls: "border-ev-hypothesis/45 text-ev-hypothesis bg-ev-hypothesis/10",
    color: "rgb(var(--ev-hypothesis))",
  },
  INCONCLUSIVE: {
    label: "Unavailable / inconclusive",
    hint: "No supported result is available for this.",
    cls: "border-ev-inconclusive/45 text-ev-inconclusive bg-ev-inconclusive/10",
    color: "rgb(var(--ev-inconclusive))",
  },
};

/** Distinct silhouettes per kind so the status survives greyscale and colour-blindness. */
export function EvidenceGlyph({ kind, size = 10 }: { kind: EvidenceKind; size?: number }): ReactNode {
  const common = { width: size, height: size, viewBox: "0 0 10 10", "aria-hidden": true, focusable: false as const };
  switch (kind) {
    case "REFERENCE": // solid disc: an observed point
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.6" fill="currentColor" />
        </svg>
      );
    case "VALIDATED": // check
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.8 5.4 4.1 7.6 8.3 2.6" />
        </svg>
      );
    case "SIMULATED": // diamond: a modelled outcome
      return (
        <svg {...common}>
          <path d="M5 .8 9.2 5 5 9.2.8 5Z" fill="currentColor" />
        </svg>
      );
    case "HYPOTHESIS": // hollow ring: not yet established
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="5" cy="5" r="3.3" strokeDasharray="2.2 1.6" />
        </svg>
      );
    case "INCONCLUSIVE": // dash
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M1.8 5h6.4" />
        </svg>
      );
  }
}

/** One scientific status per claim. Text and glyph always accompany colour. */
export function EvidenceBadge({ kind, label }: { kind: EvidenceKind; label?: string }) {
  const s = EVIDENCE_META[kind];
  return (
    <span
      title={s.hint}
      data-evidence={kind}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-5 ${s.cls}`}
    >
      <EvidenceGlyph kind={kind} />
      {label ?? s.label}
    </span>
  );
}
