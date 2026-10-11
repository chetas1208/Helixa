/**
 * Pure helix + scene-layout math (no three.js, no React). Deterministic: the same window always yields
 * the same coordinates, strands and letters. Nothing here is random.
 *
 * Mapping (documented for tests):
 *  - Strand A carries the displayed sequence 5'->3' bottom-to-top: index i <-> coordinate (start + i).
 *  - Strand B carries the Watson-Crick complement of strand A at the SAME index (A-T, C-G), drawn as the
 *    paired base across the rung. (Antiparallel orientation is a property of the molecule, not drawn.)
 *  - Geometry is an idealised B-form-like helix: 10.5 bases/turn, strand B offset by a groove angle so a major
 *    and minor groove are visible. This is an artistic rendering, not a structure.
 */
import { complementOf } from "./editorModel";

export const HELIX_RADIUS = 1.5;
export const HELIX_RISE = 0.3; // world units per base
export const HELIX_BASES_PER_TURN = 10.5;
export const HELIX_TWIST = (Math.PI * 2) / HELIX_BASES_PER_TURN;
export const HELIX_GROOVE = 2.5; // rad: strand B angular offset from strand A (major/minor groove)

export interface Vec3 { x: number; y: number; z: number }

export function helixHeight(n: number): number {
  return Math.max(0, n - 1) * HELIX_RISE;
}

/** Angle (rad) of strand A at base index i; strand B is `+ HELIX_GROOVE`. */
export function strandAngle(i: number, strand: "A" | "B"): number {
  return i * HELIX_TWIST + (strand === "B" ? HELIX_GROOVE : 0);
}

/** Local-space position of a base node. y is centred on 0 so the group pivots around the middle. */
export function nodePosition(i: number, n: number, strand: "A" | "B", radius = HELIX_RADIUS): Vec3 {
  const th = strandAngle(i, strand);
  return { x: radius * Math.cos(th), y: (i - (n - 1) / 2) * HELIX_RISE, z: radius * Math.sin(th) };
}

/** Group yaw (about Y) that turns the base pair at index i to face a camera on +Z. Shortest turn from `currentYaw`. */
export function yawToFace(i: number, currentYaw = 0): number {
  const mid = (strandAngle(i, "A") + strandAngle(i, "B")) / 2;
  // world z' = R sin(theta - yaw): maximal at theta - yaw = pi/2  =>  yaw = theta - pi/2
  const target = mid - Math.PI / 2;
  const TAU = Math.PI * 2;
  let d = (target - currentYaw) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return currentYaw + d;
}

export interface HelixBase {
  index: number;
  position: number; // 1-based coordinate
  letterA: string; // displayed letter on strand A
  letterB: string; // complement on strand B ("N" when the letter is not A/C/G/T: never invented)
  a: Vec3;
  b: Vec3;
}

/** Build the node table for a window. `bases` is the sequence to display (reference, saved or draft). */
export function buildHelixBases(bases: string, start: number): HelixBase[] {
  const n = bases.length;
  const out: HelixBase[] = [];
  for (let i = 0; i < n; i++) {
    const ch = bases[i].toUpperCase();
    out.push({
      index: i,
      position: start + i,
      letterA: complementOf(ch) ? ch : "N",
      letterB: complementOf(ch) ?? "N",
      a: nodePosition(i, n, "A"),
      b: nodePosition(i, n, "B"),
    });
  }
  return out;
}

// ---------- focus + context warp ----------
/**
 * Focus+context: the helix is drawn at full length (so the whole window is always visible) but the axis is
 * magnified around a movable focus: y' = ymin + (F(y)-F(ymin)) * H / (F(ymax)-F(ymin)),  F(y) = y + K*sigma*tanh((y-c)/sigma).
 * Order and base<->coordinate mapping are untouched; only spacing along the axis changes. It is an ARTISTIC
 * magnifier and is labelled as such in the UI. The same function runs in the vertex shaders and here (camera/tests).
 */
export const WARP_K = 1.9;
export const WARP_SIGMA = 1.9;
/** Focus weight is 1 within R0 of the focus (unwarped units) and 0 beyond R1. ~9 bases crisp, ~16 bases visible. */
export const FOCUS_R0 = 1.35;
export const FOCUS_R1 = 3.0;

export interface WarpParams { c: number; k: number; sigma: number; fMin: number; yMin: number; scale: number }

export function indexToY(i: number, n: number): number {
  return (i - (n - 1) / 2) * HELIX_RISE;
}

export function makeWarp(focusY: number, n: number, k = WARP_K, sigma = WARP_SIGMA): WarpParams {
  const h = helixHeight(n);
  const yMin = -h / 2;
  const yMax = h / 2;
  const c = Math.min(yMax, Math.max(yMin, focusY));
  const F = (y: number) => y + k * sigma * Math.tanh((y - c) / sigma);
  const fMin = F(yMin);
  const span = F(yMax) - fMin;
  return { c, k, sigma, fMin, yMin, scale: span > 1e-6 ? h / span : 1 };
}

export function warpY(y: number, p: WarpParams): number {
  return p.yMin + (y + p.k * p.sigma * Math.tanh((y - p.c) / p.sigma) - p.fMin) * p.scale;
}

/** 1 in the focus window, 0 outside; smooth. */
export function focusWeight(y: number, focusY: number): number {
  const d = Math.abs(y - focusY);
  const t = Math.min(1, Math.max(0, (d - FOCUS_R0) / (FOCUS_R1 - FOCUS_R0)));
  return 1 - t * t * (3 - 2 * t);
}

/** 0-based base index nearest to a focus position (clamped). */
export function clampIndex(i: number, n: number): number {
  return Math.min(n - 1, Math.max(0, i));
}

// ---------- scene layout ----------
/**
 * Two columns at every viewport, no view switching: the body figure fills the left column (as tall as it can
 * be), the helix fills the right column above the editor stack. Everything is computed in screen pixels and
 * converted to world units, so the DOM (which positions the stack and caption with the same fractions) and the
 * scene always agree. The camera looks straight down -Z at the origin; nothing moves when a base is selected.
 */

export interface Insets {
  /** Pixels from the viewport top to the first free row (below the top bar and the status line). */
  top: number;
  /** Pixels covered by DOM panels at the right edge (the base inspector on wide screens). */
  right: number;
  /** Pixels reserved under the body column (caption) and under the helix column (base strip + composer). */
  bottomLeft: number;
  bottomRight: number;
  /** Fraction of the viewport width given to the body column. */
  leftFrac: number;
}
/** "Not measured yet": the layout falls back to `defaultInsets` until the tab reports real panel sizes. */
export const NO_INSETS: Insets = { top: 0, right: 0, bottomLeft: 0, bottomRight: 0, leftFrac: 0 };

/** Body column share of the viewport width. Phones keep both subjects side by side. */
export function bodyColumnFraction(viewWidth: number): number {
  return viewWidth <= 768 ? 0.5 : 0.42;
}

export function defaultInsets(w: number, h: number): Insets {
  const narrow = w <= 768;
  return { top: narrow ? 104 : 96, right: 0, bottomLeft: narrow ? 0.3 * h : 44, bottomRight: narrow ? 0.3 * h : 150, leftFrac: bodyColumnFraction(w) };
}

export interface LayoutInput {
  fovDeg: number;
  split: boolean;
  helixBases: number;
  viewWidth: number;
  viewHeight: number;
  insets?: Insets;
}

export interface SceneLayout {
  bodyX: number;
  bodyY: number;
  bodyScale: number;
  helixX: number;
  helixY: number;
  helixScale: number;
  helixTilt: number; // radians about Z (kept small: the helix is vertical)
  splitGap: number;
  camDistance: number;
  /** Pixels per world unit at z = 0. */
  ppu: number;
}

/** Figure units: 10 tall (feet at -5), widest at the hands. The pedestal sits just under the soles. */
export const BODY_HEIGHT = 10;
export const BODY_WIDTH = 4.7;
const BODY_PAD = 0.45;
export const BODY_SCALE = 1.6;
export const SPLIT_GAP = 2.6;
const HELIX_W = HELIX_RADIUS * 2 + 2.2;
const HELIX_SCALE_MAX = 1.3;

const isUsable = (i: Insets | undefined): i is Insets => !!i && i.leftFrac > 0;

/** Where things sit and how far the camera stands, as a pure function of viewport + panels. */
export function computeSceneLayout(inp: LayoutInput): SceneLayout {
  const w = Math.max(200, inp.viewWidth);
  const h = Math.max(200, inp.viewHeight);
  const ins = isUsable(inp.insets) ? inp.insets : defaultInsets(w, h);
  const tan = Math.tan((inp.fovDeg * Math.PI) / 360);
  const leftW = w * ins.leftFrac;
  const rightW = Math.max(120, w - leftW - ins.right);
  const bodyFreeH = Math.max(120, h - ins.top - ins.bottomLeft);
  const helixFreeH = Math.max(120, h - ins.top - ins.bottomRight);

  // The figure decides the camera distance: as large as its column allows (height and width both checked).
  const bodyH = (BODY_HEIGHT + BODY_PAD) * BODY_SCALE;
  const bodyW = BODY_WIDTH * BODY_SCALE;
  const distH = (bodyH * h) / (2 * tan * bodyFreeH * 0.97);
  const distW = (bodyW * h) / (2 * tan * leftW * 0.9);
  const dist = Math.max(distH, distW);
  const ppu = h / (2 * dist * tan);

  // The helix then fills its own column (both helices side by side in split compare).
  const helixH = helixHeight(inp.helixBases) + 1.7;
  const helixW = HELIX_W + (inp.split ? 2 * SPLIT_GAP : 0);
  const helixScale = Math.min(HELIX_SCALE_MAX, (helixFreeH * 0.95) / ppu / helixH, (rightW * 0.86) / ppu / helixW);

  const toX = (px: number) => (px - w / 2) / ppu;
  const toY = (py: number) => (h / 2 - py) / ppu;
  const bodyCy = ins.top + bodyFreeH / 2;
  const helixCy = ins.top + helixFreeH / 2;
  return {
    bodyX: toX(leftW * 0.54),
    // the figure's visual centre is half a pad below its origin (pedestal under the feet)
    bodyY: toY(bodyCy) + (BODY_PAD / 2) * BODY_SCALE,
    bodyScale: BODY_SCALE,
    helixX: toX(leftW + rightW / 2),
    helixY: toY(helixCy),
    helixScale,
    helixTilt: -0.06,
    splitGap: SPLIT_GAP,
    camDistance: dist,
    ppu,
  };
}
