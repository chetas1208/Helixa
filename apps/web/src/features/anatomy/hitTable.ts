/**
 * Named hit volumes in body space (y=0 mid-figure, feet y=-5, +Z front, +X anatomical left).
 * Original authored ellipsoids / loft profiles — not derived from any downloaded mesh.
 */
import {
  ABDOMEN, ARM_L, ARM_R, BLADDER, BODY, BRAIN, DIGIT_INDEX_L, DIGIT_INDEX_R, DIGIT_LITTLE_L, DIGIT_LITTLE_R,
  DIGIT_MIDDLE_L, DIGIT_MIDDLE_R, DIGIT_RING_L, DIGIT_RING_R, DIGIT_THUMB_L, DIGIT_THUMB_R, EYE_L, EYE_R,
  FACE, FOOT_L, FOOT_R, HAND_L, HAND_R, HEAD, HEART, KIDNEY_L, KIDNEY_R, LEG_L, LEG_R, LIVER, LUNG_L, LUNG_R,
  NECK, PELVIS, SHOULDER_L, SHOULDER_R, SPINE, STOMACH, THORAX,
} from "./ids";
import type { ClickMapRow, HitDef, LoftSection, MeshBounds } from "./types";

const loft = (rows: LoftSection[], cap = 4): HitDef["shape"] => ({ kind: "loft", sections: rows, cap });
const ell = (center: [number, number, number], radii: [number, number, number]): HitDef["shape"] => ({
  kind: "ellipsoid",
  center,
  radii,
});
const flip = (s: LoftSection[]): LoftSection[] => s.map((q) => ({ c: [-q.c[0], q.c[1], q.c[2]], rx: q.rx, rz: q.rz }));

const ARM: LoftSection[] = [
  { c: [1.14, 2.96, 0.0], rx: 0.32, rz: 0.32 },
  { c: [1.32, 2.42, 0.03], rx: 0.28, rz: 0.28 },
  { c: [1.54, 1.88, 0.05], rx: 0.25, rz: 0.25 },
  { c: [1.72, 1.44, 0.06], rx: 0.2, rz: 0.2 },
  { c: [1.88, 0.92, 0.1], rx: 0.2, rz: 0.2 },
  { c: [1.98, 0.38, 0.12], rx: 0.12, rz: 0.12 },
];
const HAND: LoftSection[] = [
  { c: [1.98, 0.36, 0.12], rx: 0.1, rz: 0.09 },
  { c: [2.05, 0.02, 0.14], rx: 0.14, rz: 0.07 },
  { c: [2.1, -0.34, 0.15], rx: 0.13, rz: 0.055 },
  { c: [2.13, -0.72, 0.16], rx: 0.07, rz: 0.04 },
];
const LEG: LoftSection[] = [
  { c: [0.46, -0.08, 0.0], rx: 0.46, rz: 0.48 },
  { c: [0.5, -1.0, 0.02], rx: 0.44, rz: 0.46 },
  { c: [0.54, -1.88, 0.03], rx: 0.38, rz: 0.4 },
  { c: [0.56, -2.52, 0.04], rx: 0.28, rz: 0.3 },
  { c: [0.58, -3.12, -0.05], rx: 0.28, rz: 0.32 },
  { c: [0.6, -3.88, -0.03], rx: 0.2, rz: 0.22 },
  { c: [0.61, -4.52, -0.02], rx: 0.13, rz: 0.14 },
];
const FOOT: LoftSection[] = [
  { c: [0.61, -4.82, -0.18], rx: 0.14, rz: 0.14 },
  { c: [0.62, -4.88, 0.12], rx: 0.18, rz: 0.11 },
  { c: [0.63, -4.93, 0.52], rx: 0.19, rz: 0.075 },
  { c: [0.64, -4.95, 0.8], rx: 0.13, rz: 0.045 },
];
const SHOULDER: LoftSection[] = [
  { c: [0.78, 3.12, 0.0], rx: 0.22, rz: 0.36 },
  { c: [1.06, 3.08, 0.0], rx: 0.28, rz: 0.36 },
  { c: [1.26, 2.86, 0.0], rx: 0.2, rz: 0.28 },
];

function digit(side: 1 | -1, i: number): LoftSection[] {
  const spread = (i - 2) * 0.055;
  const baseX = 2.08 * side + spread * side;
  const baseY = -0.42;
  const baseZ = 0.15 + (i === 0 ? 0.06 : 0);
  const len = i === 0 ? 0.28 : 0.34 - Math.abs(i - 2) * 0.03;
  const thick = i === 0 ? 0.045 : 0.038;
  return [
    { c: [baseX, baseY, baseZ], rx: thick, rz: thick * 0.85 },
    { c: [baseX + 0.04 * side, baseY - len * 0.55, baseZ + (i === 0 ? 0.08 : 0.02)], rx: thick * 0.85, rz: thick * 0.7 },
    { c: [baseX + 0.07 * side, baseY - len, baseZ + (i === 0 ? 0.12 : 0.03)], rx: thick * 0.55, rz: thick * 0.45 },
  ];
}

export const HIT_DEFS: HitDef[] = [
  { asset_id: "mesh:body", anatomy_id: BODY, pickRank: "region", shape: ell([0, 0, 0], [2.4, 5.1, 1.1]) },
  { asset_id: "mesh:head", anatomy_id: HEAD, pickRank: "region", shape: loft([
    { c: [0, 3.68, 0.1], rx: 0.22, rz: 0.24 },
    { c: [0, 4.05, 0.06], rx: 0.46, rz: 0.54 },
    { c: [0, 4.4, 0.02], rx: 0.5, rz: 0.58 },
    { c: [0, 4.75, 0.0], rx: 0.42, rz: 0.5 },
    { c: [0, 5.0, 0.0], rx: 0.18, rz: 0.22 },
  ]) },
  { asset_id: "mesh:face", anatomy_id: FACE, pickRank: "region", shape: ell([0, 4.12, 0.42], [0.36, 0.38, 0.18]) },
  { asset_id: "mesh:neck", anatomy_id: NECK, pickRank: "region", shape: loft([
    { c: [0, 3.12, -0.02], rx: 0.22, rz: 0.23 },
    { c: [0, 3.42, -0.01], rx: 0.19, rz: 0.2 },
    { c: [0, 3.72, 0.02], rx: 0.18, rz: 0.19 },
  ]) },
  { asset_id: "mesh:thorax", anatomy_id: THORAX, pickRank: "region", shape: loft([
    { c: [0, 3.2, -0.02], rx: 0.7, rz: 0.36 },
    { c: [0, 2.7, 0.04], rx: 1.04, rz: 0.5 },
    { c: [0, 2.15, 0.05], rx: 0.98, rz: 0.52 },
    { c: [0, 1.55, 0.02], rx: 0.88, rz: 0.48 },
  ]) },
  { asset_id: "mesh:abdomen", anatomy_id: ABDOMEN, pickRank: "region", shape: loft([
    { c: [0, 1.5, 0.02], rx: 0.86, rz: 0.46 },
    { c: [0, 1.0, 0.0], rx: 0.78, rz: 0.42 },
    { c: [0, 0.5, -0.02], rx: 0.8, rz: 0.43 },
    { c: [0, 0.12, -0.04], rx: 0.86, rz: 0.48 },
  ]) },
  { asset_id: "mesh:pelvis", anatomy_id: PELVIS, pickRank: "region", shape: loft([
    { c: [0, 0.12, -0.04], rx: 0.86, rz: 0.48 },
    { c: [0, -0.35, -0.05], rx: 0.88, rz: 0.5 },
    { c: [0, -0.82, -0.03], rx: 0.64, rz: 0.38 },
  ]) },
  { asset_id: "mesh:spine", anatomy_id: SPINE, pickRank: "region", shape: loft([
    { c: [0, 3.15, -0.38], rx: 0.16, rz: 0.14 },
    { c: [0, 2.2, -0.4], rx: 0.18, rz: 0.15 },
    { c: [0, 1.1, -0.38], rx: 0.17, rz: 0.14 },
    { c: [0, 0.1, -0.36], rx: 0.2, rz: 0.16 },
    { c: [0, -0.7, -0.3], rx: 0.18, rz: 0.14 },
  ]) },
  { asset_id: "mesh:arm_L", anatomy_id: ARM_L, pickRank: "region", shape: loft(ARM) },
  { asset_id: "mesh:arm_R", anatomy_id: ARM_R, pickRank: "region", shape: loft(flip(ARM)) },
  { asset_id: "mesh:hand_L", anatomy_id: HAND_L, pickRank: "region", shape: loft(HAND, 3) },
  { asset_id: "mesh:hand_R", anatomy_id: HAND_R, pickRank: "region", shape: loft(flip(HAND), 3) },
  { asset_id: "mesh:leg_L", anatomy_id: LEG_L, pickRank: "region", shape: loft(LEG) },
  { asset_id: "mesh:leg_R", anatomy_id: LEG_R, pickRank: "region", shape: loft(flip(LEG)) },
  { asset_id: "mesh:foot_L", anatomy_id: FOOT_L, pickRank: "region", shape: loft(FOOT, 3) },
  { asset_id: "mesh:foot_R", anatomy_id: FOOT_R, pickRank: "region", shape: loft(flip(FOOT), 3) },
  { asset_id: "mesh:shoulder_L", anatomy_id: SHOULDER_L, pickRank: "region", shape: loft(SHOULDER, 3) },
  { asset_id: "mesh:shoulder_R", anatomy_id: SHOULDER_R, pickRank: "region", shape: loft(flip(SHOULDER), 3) },
  { asset_id: "mesh:brain", anatomy_id: BRAIN, pickRank: "organ", shape: ell([0, 4.42, 0.02], [0.36, 0.32, 0.38]) },
  { asset_id: "mesh:eye_L", anatomy_id: EYE_L, pickRank: "organ", shape: ell([0.16, 4.22, 0.5], [0.055, 0.045, 0.05]) },
  { asset_id: "mesh:eye_R", anatomy_id: EYE_R, pickRank: "organ", shape: ell([-0.16, 4.22, 0.5], [0.055, 0.045, 0.05]) },
  { asset_id: "mesh:heart", anatomy_id: HEART, pickRank: "organ", shape: ell([0.12, 2.28, 0.18], [0.2, 0.24, 0.16]) },
  { asset_id: "mesh:lung_L", anatomy_id: LUNG_L, pickRank: "organ", shape: ell([0.42, 2.25, 0.02], [0.32, 0.48, 0.22]) },
  { asset_id: "mesh:lung_R", anatomy_id: LUNG_R, pickRank: "organ", shape: ell([-0.42, 2.25, 0.02], [0.34, 0.5, 0.22]) },
  { asset_id: "mesh:liver", anatomy_id: LIVER, pickRank: "organ", shape: ell([-0.28, 1.18, 0.12], [0.38, 0.22, 0.2]) },
  { asset_id: "mesh:stomach", anatomy_id: STOMACH, pickRank: "organ", shape: ell([0.22, 1.05, 0.14], [0.22, 0.16, 0.14]) },
  { asset_id: "mesh:kidney_L", anatomy_id: KIDNEY_L, pickRank: "organ", shape: ell([0.32, 0.55, -0.16], [0.12, 0.18, 0.08]) },
  { asset_id: "mesh:kidney_R", anatomy_id: KIDNEY_R, pickRank: "organ", shape: ell([-0.32, 0.55, -0.16], [0.12, 0.18, 0.08]) },
  { asset_id: "mesh:bladder", anatomy_id: BLADDER, pickRank: "organ", shape: ell([0, -0.28, 0.12], [0.16, 0.12, 0.1]) },
  { asset_id: "mesh:digit_L_1", anatomy_id: DIGIT_THUMB_L, pickRank: "digit", shape: loft(digit(1, 0), 2) },
  { asset_id: "mesh:digit_L_2", anatomy_id: DIGIT_INDEX_L, pickRank: "digit", shape: loft(digit(1, 1), 2) },
  { asset_id: "mesh:digit_L_3", anatomy_id: DIGIT_MIDDLE_L, pickRank: "digit", shape: loft(digit(1, 2), 2) },
  { asset_id: "mesh:digit_L_4", anatomy_id: DIGIT_RING_L, pickRank: "digit", shape: loft(digit(1, 3), 2) },
  { asset_id: "mesh:digit_L_5", anatomy_id: DIGIT_LITTLE_L, pickRank: "digit", shape: loft(digit(1, 4), 2) },
  { asset_id: "mesh:digit_R_1", anatomy_id: DIGIT_THUMB_R, pickRank: "digit", shape: loft(digit(-1, 0), 2) },
  { asset_id: "mesh:digit_R_2", anatomy_id: DIGIT_INDEX_R, pickRank: "digit", shape: loft(digit(-1, 1), 2) },
  { asset_id: "mesh:digit_R_3", anatomy_id: DIGIT_MIDDLE_R, pickRank: "digit", shape: loft(digit(-1, 2), 2) },
  { asset_id: "mesh:digit_R_4", anatomy_id: DIGIT_RING_R, pickRank: "digit", shape: loft(digit(-1, 3), 2) },
  { asset_id: "mesh:digit_R_5", anatomy_id: DIGIT_LITTLE_R, pickRank: "digit", shape: loft(digit(-1, 4), 2) },
];

export const HIT_BY_ASSET = Object.fromEntries(HIT_DEFS.map((h) => [h.asset_id, h])) as Record<string, HitDef>;

const RANK = { digit: 3, organ: 2, region: 1 } as const;
export const pickRankScore = (rank: HitDef["pickRank"]): number => RANK[rank];

export function boundsOfShape(shape: HitDef["shape"]): MeshBounds {
  if (shape.kind === "ellipsoid") {
    const [cx, cy, cz] = shape.center;
    const [rx, ry, rz] = shape.radii;
    return { min: [cx - rx, cy - ry, cz - rz], max: [cx + rx, cy + ry, cz + rz] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const s of shape.sections) {
    minX = Math.min(minX, s.c[0] - s.rx); maxX = Math.max(maxX, s.c[0] + s.rx);
    minY = Math.min(minY, s.c[1] - Math.max(s.rx, s.rz) * 0.4); maxY = Math.max(maxY, s.c[1] + Math.max(s.rx, s.rz) * 0.4);
    minZ = Math.min(minZ, s.c[2] - s.rz); maxZ = Math.max(maxZ, s.c[2] + s.rz);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function anchorOfShape(shape: HitDef["shape"]): [number, number, number] {
  const b = boundsOfShape(shape);
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

const PAIR: Record<string, string> = {
  [ARM_L]: ARM_R, [ARM_R]: ARM_L,
  [HAND_L]: HAND_R, [HAND_R]: HAND_L,
  [LEG_L]: LEG_R, [LEG_R]: LEG_L,
  [FOOT_L]: FOOT_R, [FOOT_R]: FOOT_L,
  [EYE_L]: EYE_R, [EYE_R]: EYE_L,
  [LUNG_L]: LUNG_R, [LUNG_R]: LUNG_L,
  [KIDNEY_L]: KIDNEY_R, [KIDNEY_R]: KIDNEY_L,
  [SHOULDER_L]: SHOULDER_R, [SHOULDER_R]: SHOULDER_L,
  [DIGIT_THUMB_L]: DIGIT_THUMB_R, [DIGIT_THUMB_R]: DIGIT_THUMB_L,
  [DIGIT_INDEX_L]: DIGIT_INDEX_R, [DIGIT_INDEX_R]: DIGIT_INDEX_L,
  [DIGIT_MIDDLE_L]: DIGIT_MIDDLE_R, [DIGIT_MIDDLE_R]: DIGIT_MIDDLE_L,
  [DIGIT_RING_L]: DIGIT_RING_R, [DIGIT_RING_R]: DIGIT_RING_L,
  [DIGIT_LITTLE_L]: DIGIT_LITTLE_R, [DIGIT_LITTLE_R]: DIGIT_LITTLE_L,
};

function sideOf(id: string): ClickMapRow["side"] {
  if (id.endsWith("@left") || id === EYE_L || id === LUNG_L || id === KIDNEY_L) return "left";
  if (id.endsWith("@right") || id === EYE_R || id === LUNG_R || id === KIDNEY_R) return "right";
  return "midline";
}

/** Click mapping table: every modeled/approximate hotspot → contract anatomy_id. */
export const CLICK_MAP: ClickMapRow[] = HIT_DEFS.filter((h) => h.asset_id !== "mesh:body").map((h) => ({
  hotspot: h.asset_id.replace(/^mesh:/, ""),
  asset_id: h.asset_id,
  anatomy_id: h.anatomy_id,
  side: sideOf(h.anatomy_id),
  counterpart_id: PAIR[h.anatomy_id] ?? null,
}));
