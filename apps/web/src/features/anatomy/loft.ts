/**
 * Original V14 elliptical loft. Written for the anatomy atlas; not copied from V12 bodyGeometry.
 * Centers are interpolated along a polyline; each ring is an ellipse in a stable parallel-transport frame.
 */
import * as THREE from "three";
import type { LoftSection } from "./types";

export interface LoftOpts {
  radial?: number;
  perSegment?: number;
  cap?: number;
}

function transportFrame(tangent: THREE.Vector3, prevX: THREE.Vector3): { x: THREE.Vector3; z: THREE.Vector3 } {
  const x = prevX.clone().addScaledVector(tangent, -prevX.dot(tangent));
  if (x.lengthSq() < 1e-8) {
    const fallback = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    x.copy(fallback).cross(tangent);
  }
  x.normalize();
  const z = new THREE.Vector3().crossVectors(tangent, x).normalize();
  return { x, z };
}

function lerpSection(a: LoftSection, b: LoftSection, t: number): LoftSection {
  const s = t * t * (3 - 2 * t);
  return {
    c: [a.c[0] + (b.c[0] - a.c[0]) * s, a.c[1] + (b.c[1] - a.c[1]) * s, a.c[2] + (b.c[2] - a.c[2]) * s],
    rx: a.rx + (b.rx - a.rx) * s,
    rz: a.rz + (b.rz - a.rz) * s,
  };
}

/** Build a capped elliptical tube through `sections`. */
export function loftEllipses(sections: LoftSection[], opts: LoftOpts = {}): THREE.BufferGeometry {
  const radial = Math.max(6, opts.radial ?? 16);
  const per = Math.max(2, opts.perSegment ?? 4);
  const cap = Math.max(0, opts.cap ?? 3);
  if (sections.length < 2) throw new Error("loftEllipses needs at least two sections");

  const samples: LoftSection[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const steps = i === sections.length - 2 ? per : per;
    for (let k = 0; k < steps; k++) samples.push(lerpSection(sections[i], sections[i + 1], k / steps));
  }
  samples.push(sections[sections.length - 1]);

  const tanAt = (i: number): THREE.Vector3 => {
    const a = samples[Math.max(0, i - 1)].c;
    const b = samples[Math.min(samples.length - 1, i + 1)].c;
    const t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (t.lengthSq() < 1e-10) t.set(0, 1, 0);
    return t.normalize();
  };

  type Ring = { c: THREE.Vector3; rx: number; rz: number; t: THREE.Vector3 };
  const rings: Ring[] = samples.map((s, i) => ({
    c: new THREE.Vector3(s.c[0], s.c[1], s.c[2]),
    rx: Math.max(0.002, s.rx),
    rz: Math.max(0.002, s.rz),
    t: tanAt(i),
  }));

  const capRings = (end: "start" | "end"): Ring[] => {
    if (cap === 0) return [];
    const base = end === "start" ? rings[0] : rings[rings.length - 1];
    const dir = base.t.clone().multiplyScalar(end === "start" ? -1 : 1);
    const reach = Math.min(base.rx, base.rz) * 0.85;
    const extra: Ring[] = [];
    for (let k = 1; k <= cap; k++) {
      const a = (k / cap) * (Math.PI / 2);
      extra.push({
        c: base.c.clone().addScaledVector(dir, Math.sin(a) * reach),
        rx: Math.max(0.002, base.rx * Math.cos(a)),
        rz: Math.max(0.002, base.rz * Math.cos(a)),
        t: base.t,
      });
    }
    return extra;
  };
  const all = [...capRings("start").reverse(), ...rings, ...capRings("end")];

  let prevX = new THREE.Vector3(1, 0, 0);
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of all) {
    const frame = transportFrame(r.t, prevX);
    prevX = frame.x;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const p = r.c.clone().addScaledVector(frame.x, Math.cos(a) * r.rx).addScaledVector(frame.z, Math.sin(a) * r.rz);
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
  return g;
}

export function ellipsoidGeometry(center: [number, number, number], radii: [number, number, number], segs: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, Math.max(8, segs), Math.max(6, Math.floor(segs * 0.7)));
  g.scale(radii[0], radii[1], radii[2]);
  g.translate(center[0], center[1], center[2]);
  return g;
}

/** Deterministic area-weighted surface samples (seeded). Used for the optional particle skin. */
export function sampleSurface(geometry: THREE.BufferGeometry, count: number, seed = 20261011): Float32Array {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const nor = geometry.getAttribute("normal") as THREE.BufferAttribute;
  const index = geometry.index;
  if (!index || count <= 0) return new Float32Array(0);
  const tris = index.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  const cum = new Float32Array(tris);
  let total = 0;
  for (let i = 0; i < tris; i++) {
    a.fromBufferAttribute(pos, index.getX(i * 3));
    b.fromBufferAttribute(pos, index.getX(i * 3 + 1));
    c.fromBufferAttribute(pos, index.getX(i * 3 + 2));
    total += t1.subVectors(b, a).cross(t2.subVectors(c, a)).length() * 0.5;
    cum[i] = total;
  }
  let st = seed >>> 0;
  const rnd = () => {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    return st / 4294967296;
  };
  const out = new Float32Array(count * 3);
  const n1 = new THREE.Vector3(), n2 = new THREE.Vector3(), n3 = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    const target = rnd() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i0 = index.getX(lo * 3), i1 = index.getX(lo * 3 + 1), i2 = index.getX(lo * 3 + 2);
    let u = rnd(), v = rnd();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    n1.fromBufferAttribute(nor, i0); n2.fromBufferAttribute(nor, i1); n3.fromBufferAttribute(nor, i2);
    const nx = n1.x * w + n2.x * u + n3.x * v;
    const ny = n1.y * w + n2.y * u + n3.y * v;
    const nz = n1.z * w + n2.z * u + n3.z * v;
    const nl = Math.hypot(nx, ny, nz) || 1;
    out[k * 3] = a.x * w + b.x * u + c.x * v + (nx / nl) * 0.014;
    out[k * 3 + 1] = a.y * w + b.y * u + c.y * v + (ny / nl) * 0.014;
    out[k * 3 + 2] = a.z * w + b.z * u + c.z * v + (nz / nl) * 0.014;
  }
  return out;
}
