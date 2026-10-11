/**
 * Pure geometry for the sequence fingerprint: a deterministic mini double helix drawn from the
 * REAL preview bases of a revision. No randomness; the same input always yields the same drawing.
 */
import type { Edit } from "../types";

export type BaseLetter = "A" | "C" | "G" | "T" | "N";
const COMPLEMENT: Record<BaseLetter, BaseLetter> = { A: "T", T: "A", C: "G", G: "C", N: "N" };

/** Colour per nucleotide. Letters are always shown as text elsewhere (never colour alone). */
export const BASE_COLOR: Record<BaseLetter, string> = {
  A: "#5eead4",
  T: "#60a5fa",
  C: "#a78bfa",
  G: "#f472b6",
  N: "#64748b",
};
export const LIT_COLOR = "#fbbf24";

export const toBase = (c: string | undefined): BaseLetter => {
  const u = (c ?? "").toUpperCase();
  return u === "A" || u === "C" || u === "G" || u === "T" ? u : "N";
};
export const complementOf = (b: BaseLetter): BaseLetter => COMPLEMENT[b];

export interface FingerprintCell {
  /** 0-based index in the window; position = index + 1 (1-based, as everywhere else). */
  index: number;
  position: number;
  base: BaseLetter;
  complement: BaseLetter;
  x: number;
  /** Strand 1 / strand 2 vertical positions on the helix. */
  y1: number;
  y2: number;
  /** cos(phase): >0 means strand 1 is in front. Drives size and opacity. */
  depth: number;
  /** |sin(phase)|: rung length factor. */
  span: number;
  lit: boolean;
}

export interface FingerprintGeometry {
  width: number;
  height: number;
  cells: FingerprintCell[];
}

/** Turns per window: about 3.3, so 48 bases read as an elegant helix at thumbnail size. */
const PHASE_STEP = 0.43;

export function fingerprintGeometry(
  preview: string,
  lit: ReadonlySet<number>,
  opts: { step: number; height: number; amplitudeRatio?: number; padding?: number },
): FingerprintGeometry {
  const { step, height } = opts;
  const pad = opts.padding ?? step;
  const amp = (height / 2 - 6) * (opts.amplitudeRatio ?? 1);
  const mid = height / 2;
  const cells: FingerprintCell[] = Array.from(preview).map((ch, i) => {
    const phase = i * PHASE_STEP;
    const s = Math.sin(phase);
    const base = toBase(ch);
    return {
      index: i,
      position: i + 1,
      base,
      complement: complementOf(base),
      x: pad + i * step,
      y1: mid + amp * s,
      y2: mid - amp * s,
      depth: Math.cos(phase),
      span: Math.abs(s),
      lit: lit.has(i + 1),
    };
  });
  return { width: pad * 2 + Math.max(0, preview.length - 1) * step, height, cells };
}

/** Positions (1-based) whose final allele is set by an edit. Later edits at a position win. */
export function editedPositions(edits: readonly Edit[]): Set<number> {
  return new Set(edits.map((e) => e.position));
}

/** Positions (1-based) where two equal-or-different-length previews disagree. */
export function differingPositions(a: string, b: string): Set<number> {
  const out = new Set<number>();
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.add(i + 1);
  return out;
}
