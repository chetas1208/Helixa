/**
 * Procedural neutral human silhouette: smooth lofted solids merged into ONE BufferGeometry
 * (no GLB, no asset). Purely illustrative; the shape is fixed and never derives from sequence data.
 * Units: 10 tall, y=0 at mid-figure, feet at y=-5, +Z faces front.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

interface Section {
  c: [number, number, number];
  rx: number;
  rz: number;
}

const V = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);

/** Smooth tube/loft through sections with elliptical cross-sections and rounded end caps. */
function loft(sections: Section[], opts: { radial?: number; perSegment?: number; cap?: number; capStart?: boolean; capEnd?: boolean } = {}): THREE.BufferGeometry {
  const radial = opts.radial ?? 28;
  const per = opts.perSegment ?? 7;
  const capSteps = opts.cap ?? 5;
  const centre = new THREE.CatmullRomCurve3(sections.map((s) => V(s.c)), false, "catmullrom", 0.5);
  const radii = new THREE.CatmullRomCurve3(sections.map((s) => new THREE.Vector3(s.rx, s.rz, 0)), false, "catmullrom", 0.5);

  const steps = (sections.length - 1) * per;
  const rings: { c: THREE.Vector3; rx: number; rz: number; t: THREE.Vector3 }[] = [];
  const tmpC = new THREE.Vector3();
  const tmpR = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    centre.getPoint(u, tmpC);
    radii.getPoint(u, tmpR);
    rings.push({ c: tmpC.clone(), rx: Math.max(0.001, tmpR.x), rz: Math.max(0.001, tmpR.y), t: centre.getTangent(u).normalize() });
  }
  // round caps: shrink radii with a quarter ellipse while extending along the tangent
  const capRings = (end: "start" | "end") => {
    const base = end === "start" ? rings[0] : rings[rings.length - 1];
    const dir = base.t.clone().multiplyScalar(end === "start" ? -1 : 1);
    const reach = Math.min(base.rx, base.rz) * 0.9;
    const out: typeof rings = [];
    for (let k = 1; k <= capSteps; k++) {
      const a = (k / capSteps) * (Math.PI / 2);
      out.push({ c: base.c.clone().addScaledVector(dir, Math.sin(a) * reach), rx: Math.max(0.001, base.rx * Math.cos(a)), rz: Math.max(0.001, base.rz * Math.cos(a)), t: base.t });
    }
    return out;
  };
  const all = [
    ...(opts.capStart === false ? [] : capRings("start").reverse()),
    ...rings,
    ...(opts.capEnd === false ? [] : capRings("end")),
  ];

  const ref = new THREE.Vector3(0, 0, 1);
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of all) {
    let xAxis = new THREE.Vector3().crossVectors(ref, r.t);
    if (xAxis.lengthSq() < 1e-6) xAxis = new THREE.Vector3(1, 0, 0);
    xAxis.normalize();
    const zAxis = new THREE.Vector3().crossVectors(r.t, xAxis).normalize();
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const p = r.c.clone().addScaledVector(xAxis, Math.cos(a) * r.rx).addScaledVector(zAxis, Math.sin(a) * r.rz);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < all.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + ((j + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // consistent facing: make sure normals point outward (flip if the average points inward)
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const mid = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) mid.add(new THREE.Vector3().fromBufferAttribute(p, i));
  mid.divideScalar(p.count);
  let outward = 0;
  for (let i = 0; i < p.count; i += 7) outward += new THREE.Vector3().fromBufferAttribute(p, i).sub(mid).dot(new THREE.Vector3().fromBufferAttribute(n, i));
  if (outward < 0) {
    const flipped = idx.slice();
    for (let i = 0; i < flipped.length; i += 3) { const t = flipped[i + 1]; flipped[i + 1] = flipped[i + 2]; flipped[i + 2] = t; }
    g.setIndex(flipped);
    g.computeVertexNormals();
  }
  return g;
}


/**
 * Build the whole figure as one merged geometry. Hand-tuned profile tables, ~7.5 heads tall, natural A-pose.
 * Landmarks (y): crown 5.0, chin 3.67, shoulders 3.05, elbow 1.47, wrist 0.35, crotch 0.0, knee -2.55, ankle -4.6, sole -5.
 * Table rows: [y, rx (half width), rz (half depth), cz (forward offset)].
 */
type Row = [number, number, number, number];
const spine = (rows: Row[]): Section[] => rows.map(([y, rx, rz, cz]) => ({ c: [0, y, cz], rx, rz }));

const HEAD: Row[] = [
  [3.66, 0.1, 0.14, 0.12], [3.78, 0.3, 0.38, 0.08], [4.0, 0.44, 0.53, 0.05], [4.3, 0.5, 0.59, 0.02],
  [4.6, 0.49, 0.58, 0.0], [4.85, 0.38, 0.46, 0.0], [4.99, 0.17, 0.2, 0.0],
];
const NECK: Row[] = [[3.1, 0.24, 0.25, -0.03], [3.45, 0.2, 0.21, -0.02], [3.8, 0.19, 0.2, 0.02]];
const TORSO: Row[] = [
  [3.62, 0.27, 0.25, -0.03], [3.44, 0.46, 0.31, -0.03], [3.26, 0.88, 0.38, -0.02], [3.05, 1.14, 0.44, -0.01],
  [2.7, 1.06, 0.52, 0.05], [2.2, 1.0, 0.55, 0.05], [1.6, 0.9, 0.5, 0.02], [1.0, 0.78, 0.43, -0.01],
  [0.5, 0.8, 0.44, -0.03], [0.05, 0.9, 0.5, -0.05], [-0.4, 0.88, 0.5, -0.05], [-0.85, 0.66, 0.4, -0.02],
];

const mirrorX = (s: Section[]): Section[] => s.map((q) => ({ c: [-q.c[0], q.c[1], q.c[2]], rx: q.rx, rz: q.rz }));

export function buildBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const L = { radial: 48, perSegment: 10 };
  parts.push(loft(spine(HEAD), { ...L, cap: 7 }));
  parts.push(loft(spine(NECK), { radial: 28, perSegment: 6, cap: 2 }));
  parts.push(loft(spine(TORSO), { ...L, radial: 56 }));

  // Legs: hip -> thigh -> knee -> calf -> ankle. Slightly apart (A-pose), calf bulges back.
  const leg: Section[] = [
    { c: [0.46, -0.1, 0.0], rx: 0.48, rz: 0.5 },
    { c: [0.5, -1.0, 0.02], rx: 0.46, rz: 0.48 },
    { c: [0.54, -1.9, 0.03], rx: 0.4, rz: 0.43 },
    { c: [0.56, -2.55, 0.04], rx: 0.29, rz: 0.31 },
    { c: [0.58, -3.1, -0.06], rx: 0.3, rz: 0.34 },
    { c: [0.6, -3.9, -0.04], rx: 0.21, rz: 0.24 },
    { c: [0.61, -4.55, -0.02], rx: 0.13, rz: 0.15 },
  ];
  parts.push(loft(leg, { ...L, radial: 36 }), loft(mirrorX(leg), { ...L, radial: 36 }));

  // Feet: low wedge lofted forward.
  const foot: Section[] = [
    { c: [0.61, -4.84, -0.2], rx: 0.14, rz: 0.15 },
    { c: [0.62, -4.88, 0.1], rx: 0.18, rz: 0.12 },
    { c: [0.63, -4.93, 0.55], rx: 0.2, rz: 0.08 },
    { c: [0.64, -4.95, 0.82], rx: 0.14, rz: 0.05 },
  ];
  parts.push(loft(foot, { radial: 20, perSegment: 6, cap: 3 }), loft(mirrorX(foot), { radial: 20, perSegment: 6, cap: 3 }));

  // Arms: deltoid -> biceps -> elbow -> forearm -> wrist. Relaxed A-pose with a slight forward carry.
  const arm: Section[] = [
    { c: [1.16, 2.98, 0.0], rx: 0.34, rz: 0.34 },
    { c: [1.3, 2.5, 0.02], rx: 0.3, rz: 0.3 },
    { c: [1.55, 1.95, 0.04], rx: 0.27, rz: 0.27 },
    { c: [1.72, 1.47, 0.05], rx: 0.22, rz: 0.22 },
    { c: [1.85, 1.0, 0.09], rx: 0.22, rz: 0.22 },
    { c: [1.98, 0.35, 0.12], rx: 0.12, rz: 0.12 },
  ];
  parts.push(loft(arm, { ...L, radial: 32 }), loft(mirrorX(arm), { ...L, radial: 32 }));
  const hand: Section[] = [
    { c: [1.98, 0.35, 0.12], rx: 0.1, rz: 0.1 },
    { c: [2.04, 0.0, 0.14], rx: 0.14, rz: 0.075 },
    { c: [2.09, -0.38, 0.15], rx: 0.13, rz: 0.06 },
    { c: [2.12, -0.8, 0.16], rx: 0.07, rz: 0.04 },
  ];
  parts.push(loft(hand, { radial: 18, perSegment: 5, cap: 3 }), loft(mirrorX(hand), { radial: 18, perSegment: 5, cap: 3 }));

  const shoulder: Section[] = [
    { c: [0.8, 3.14, 0.0], rx: 0.22, rz: 0.4 },
    { c: [1.08, 3.1, 0.0], rx: 0.3, rz: 0.4 },
    { c: [1.3, 2.88, 0.0], rx: 0.2, rz: 0.3 },
  ];
  parts.push(loft(shoulder, { radial: 24, perSegment: 5, cap: 3 }), loft(mirrorX(shoulder), { radial: 24, perSegment: 5, cap: 3 }));

  const merged = mergeGeometries(parts.map((g) => { g.deleteAttribute("uv"); return g; }), false);
  parts.forEach((g) => g.dispose());
  if (!merged) throw new Error("body geometry merge failed");
  merged.computeBoundingSphere();
  return merged;
}

/** Deterministic (seeded) area-weighted surface samples for the particle skin. Same figure -> same dots. */
export function sampleSurface(geometry: THREE.BufferGeometry, count: number, seed = 20260101): Float32Array {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const nor = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const idx = geometry.index as THREE.BufferAttribute;
  const tris = idx.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  const cum = new Float32Array(tris);
  let total = 0;
  for (let i = 0; i < tris; i++) {
    a.fromBufferAttribute(pos, idx.getX(i * 3)); b.fromBufferAttribute(pos, idx.getX(i * 3 + 1)); c.fromBufferAttribute(pos, idx.getX(i * 3 + 2));
    total += t1.subVectors(b, a).cross(t2.subVectors(c, a)).length() / 2;
    cum[i] = total;
  }
  let st = seed >>> 0;
  const rnd = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = new Float32Array(count * 3);
  const n1 = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const target = rnd() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
    const i0 = idx.getX(lo * 3), i1 = idx.getX(lo * 3 + 1), i2 = idx.getX(lo * 3 + 2);
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    n1.fromBufferAttribute(nor, i0).multiplyScalar(w).addScaledVector(new THREE.Vector3().fromBufferAttribute(nor, i1), u).addScaledVector(new THREE.Vector3().fromBufferAttribute(nor, i2), v).normalize();
    out[k * 3] = a.x * w + b.x * u + c.x * v + n1.x * 0.012;
    out[k * 3 + 1] = a.y * w + b.y * u + c.y * v + n1.y * 0.012;
    out[k * 3 + 2] = a.z * w + b.z * u + c.z * v + n1.z * 0.012;
  }
  return out;
}
