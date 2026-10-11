import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildHelixBases, makeWarp, nodePosition, warpY } from "./helixGeometry";
import type { HelixBase } from "./helixGeometry";
import { CELL, letterCell, shapeCell, Sprites } from "./Sprites";
import type { SpriteItem } from "./Sprites";
import { complementOf, pairBondCount } from "./editorModel";
import { createWarpUniforms, patchInstancedForWarp, setWarp, WARP_GLSL } from "./warpShader";

/**
 * The hero: an instanced, luminous DNA double helix of a REAL loaded window.
 *  - Focus + context: the axis is magnified around `focusRef` (a movable ~12-base window shows large badges with
 *    letters; the rest shrinks to small luminous dots). Order and coordinates are never altered, only spacing: artistic.
 *  - Instanced: 2n nodes, 2n half-rungs, <=3n hydrogen-bond beads, billboard badges/letters/glow/markers.
 *  - Backbones: two glass-like tubes (fresnel rim + bright core) plus an additive halo shell.
 *  - Per frame the only work is updating 3 shader uniforms when the focus moves. No React state per frame.
 */

// A/T = cool family, C/G = violet family. Letters + shapes carry identity; colour only supports.
const BASE_COLOR: Record<string, string> = { A: "#63d8ff", T: "#5ff3d3", C: "#6b8dff", G: "#bb8fff", N: "#8a97b3" };
const colorOf = (ch: string) => new THREE.Color(BASE_COLOR[ch] ?? BASE_COLOR.N);

const NODE_R = 0.2;
const NODE_R_CHANGED = 0.27;
const NODE_R_SELECTED = 0.31;
const TUBE_R = 0.085;

const TUBE_VERT = /* glsl */ `
  uniform float uR;
  uniform float uRadiusMul;
  ${WARP_GLSL}
  varying vec3 vN;
  varying vec3 vV;
  varying float vFw;
  varying float vT;
  void main() {
    vec3 ctr = position - normal * uR;
    float fw = focusW(ctr.y);
    float rr = uR * uRadiusMul * mix(0.5, 1.0, fw);
    vec3 p = ctr + normal * rr;
    p.y = warpY(ctr.y) + normal.y * rr;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vFw = fw;
    vT = clamp(ctr.y / 8.0 + 0.5, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const TUBE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uColor2;
  uniform vec3 uRim;
  uniform float uAlpha;
  uniform float uCore;
  uniform float uRimK;
  varying vec3 vN;
  varying vec3 vV;
  varying float vFw;
  varying float vT;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    float ndv = abs(dot(n, v));
    float rim = pow(1.0 - ndv, 2.0);
    float core = pow(ndv, 3.0);
    vec3 base = mix(uColor, uColor2, vT);
    vec3 col = base * (0.35 + 0.9 * core) + uRim * rim * uRimK + vec3(1.0) * core * core * uCore;
    float a = (uAlpha + rim * 0.65 * uRimK + core * 0.4 * uCore) * mix(0.6, 1.0, vFw);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

function makeTubeMaterial(warp: ReturnType<typeof createWarpUniforms>, o: { color: string; color2: string; rim: string; alpha: number; core: number; rimK: number; radiusMul: number; additive: boolean }) {
  return new THREE.ShaderMaterial({
    vertexShader: TUBE_VERT,
    fragmentShader: TUBE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: {
      uR: { value: TUBE_R },
      uRadiusMul: { value: o.radiusMul },
      uColor: { value: new THREE.Color(o.color) },
      uColor2: { value: new THREE.Color(o.color2) },
      uRim: { value: new THREE.Color(o.rim) },
      uAlpha: { value: o.alpha },
      uCore: { value: o.core },
      uRimK: { value: o.rimK },
      ...warp,
    },
  });
}

export const HELIX_FLASH_S = 0.7;

/** Clock time + base index of the latest draft change; written by the scene, read per frame. */
export interface FlashState { at: number; index: number }

let ringTexture: THREE.CanvasTexture | null = null;
function getRingTexture(): THREE.CanvasTexture {
  if (ringTexture) return ringTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(64, 64, 30, 64, 64, 62);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.72, "rgba(255,236,170,0.95)");
    grad.addColorStop(0.82, "rgba(255,255,255,1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  ringTexture = new THREE.CanvasTexture(c);
  return ringTexture;
}

/** Expanding ring + core flash at the base that just changed. Decorative acknowledgement; carries no data. */
function EditFlash({ flashRef, focusRef, n }: { flashRef: MutableRefObject<FlashState>; focusRef: MutableRefObject<number>; n: number }) {
  const ring = useRef<THREE.Sprite>(null);
  const core = useRef<THREE.Sprite>(null);
  const mats = useMemo(() => {
    const tex = getRingTexture();
    const mk = (color: string) => new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    return { ring: mk("#ffd27a"), core: mk("#ffffff") };
  }, []);
  useEffect(() => () => { mats.ring.dispose(); mats.core.dispose(); }, [mats]);
  useFrame((state) => {
    const r = ring.current, c = core.current;
    if (!r || !c) return;
    const f = flashRef.current;
    const t = state.clock.elapsedTime - f.at;
    const on = t >= 0 && t <= HELIX_FLASH_S && f.index >= 0 && f.index < n;
    r.visible = c.visible = on;
    if (!on) return;
    const u = t / HELIX_FLASH_S;
    const a = nodePosition(f.index, n, "A"), b = nodePosition(f.index, n, "B");
    const y = warpY(a.y, makeWarp(focusRef.current, n));
    r.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    c.position.copy(r.position);
    r.scale.setScalar(0.8 + u * 5.2);
    c.scale.setScalar(2.6 * (1 - u) + 0.4);
    mats.ring.opacity = (1 - u) ** 1.4;
    mats.core.opacity = (1 - u) ** 3 * 0.9;
  });
  return (
    <>
      <sprite ref={ring} material={mats.ring} renderOrder={11} visible={false} />
      <sprite ref={core} material={mats.core} renderOrder={11} visible={false} />
    </>
  );
}

export interface HelixApi {
  /** Nearest base (1-based coordinate) to a pointer position, using the warped on-screen layout. Null if nothing is close. */
  pick(camera: THREE.Camera, clientX: number, clientY: number, rect: DOMRect): number | null;
}

export interface HelixModelProps {
  bases: string;
  start: number;
  /** Positions where `bases` differs from the saved revision (unsaved draft): dashed amber ring. */
  draftChanged: ReadonlySet<number>;
  /** Positions where the saved revision differs from baseline: solid ring. */
  savedChanged: ReadonlySet<number>;
  /** Letter this base had before (aligned with `bases`; null when unchanged). Drawn as a small "was" badge beside the node. */
  refLetters: ReadonlyArray<string | null>;
  selectedPosition: number | null;
  /** Current focus (unwarped local y). Read inside useFrame; the scene eases it. */
  focusRef: MutableRefObject<number>;
  apiRef?: MutableRefObject<HelixApi | null>;
  flashRef?: MutableRefObject<FlashState>;
}

export const HelixModel = forwardRef<THREE.Group, HelixModelProps>(function HelixModel(
  { bases, start, draftChanged, savedChanged, refLetters, selectedPosition, focusRef, apiRef, flashRef },
  ref,
) {
  const n = bases.length;
  const table = useMemo(() => buildHelixBases(bases, start), [bases, start]);
  const warp = useMemo(() => createWarpUniforms(), []);
  const groupRef = useRef<THREE.Group>(null);
  useImperativeHandle(ref, () => groupRef.current as THREE.Group, []);

  const nodesRef = useRef<THREE.InstancedMesh>(null);
  const rungsRef = useRef<THREE.InstancedMesh>(null);
  const beadsRef = useRef<THREE.InstancedMesh>(null);

  const sphere = useMemo(() => new THREE.SphereGeometry(1, 24, 18), []);
  const cyl = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 10, 1, false), []);
  const nodeMat = useMemo(() => { const m = new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.2 }); patchInstancedForWarp(m, warp, 0.36, 0, 0.75); return m; }, [warp]);
  const rungMat = useMemo(() => { const m = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 }); patchInstancedForWarp(m, warp, 0.5, 1, 1.1); return m; }, [warp]);
  const beadMat = useMemo(() => { const m = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0 }); patchInstancedForWarp(m, warp, 0.25, 0, 1.2); return m; }, [warp]);

  const backbone = useMemo(() => {
    const mk = (strand: "A" | "B") => {
      const pts: THREE.Vector3[] = [];
      for (let i = -1; i <= n; i++) {
        const p = nodePosition(i, n, strand);
        pts.push(new THREE.Vector3(p.x, p.y, p.z));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
      return new THREE.TubeGeometry(curve, Math.max(60, (n + 1) * 16), TUBE_R, 14, false);
    };
    return { a: mk("A"), b: mk("B") };
  }, [n]);
  const tubeMats = useMemo(
    () => ({
      a: makeTubeMaterial(warp, { color: "#3fb7ff", color2: "#8fe9ff", rim: "#bff4ff", alpha: 0.22, core: 0.95, rimK: 1.0, radiusMul: 1, additive: false }),
      b: makeTubeMaterial(warp, { color: "#7a62ff", color2: "#c09bff", rim: "#e0ccff", alpha: 0.22, core: 0.85, rimK: 1.0, radiusMul: 1, additive: false }),
      haloA: makeTubeMaterial(warp, { color: "#3aa8ff", color2: "#6fe2ff", rim: "#6fe2ff", alpha: 0.05, core: 0, rimK: 0.25, radiusMul: 3.2, additive: true }),
      haloB: makeTubeMaterial(warp, { color: "#6f5aff", color2: "#b189ff", rim: "#b189ff", alpha: 0.05, core: 0, rimK: 0.25, radiusMul: 3.2, additive: true }),
    }),
    [warp],
  );

  // warp uniforms follow the (eased) focus
  const lastFocus = useRef(Number.NaN);
  useFrame(() => {
    const f = focusRef.current;
    if (f === lastFocus.current) return;
    lastFocus.current = f;
    setWarp(warp, makeWarp(f, n));
  });
  useLayoutEffect(() => { setWarp(warp, makeWarp(focusRef.current, n)); lastFocus.current = focusRef.current; }, [warp, n, focusRef]);

  // pointer picking against the WARPED layout (CPU raycasts would ignore the vertex-shader warp)
  useEffect(() => {
    if (!apiRef) return;
    const v = new THREE.Vector3();
    const api: HelixApi = {
      pick(camera, clientX, clientY, rect) {
        const g = groupRef.current;
        if (!g) return null;
        g.updateWorldMatrix(true, false);
        const wp = makeWarp(focusRef.current, n);
        let best: HelixBase | null = null;
        let bestD = Infinity;
        const px = (lx: number, ly: number, lz: number) => {
          v.set(lx, warpY(ly, wp), lz).applyMatrix4(g.matrixWorld).project(camera);
          return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height, v.z] as const;
        };
        for (const b of table) {
          for (const [x, z] of [[b.a.x, b.a.z], [b.b.x, b.b.z], [(b.a.x + b.b.x) / 2, (b.a.z + b.b.z) / 2]] as const) {
            const [sx, sy, sz] = px(x, b.a.y, z);
            const d = Math.hypot(sx - clientX, sy - clientY) + sz * 3; // prefer nearer nodes on ties
            if (d < bestD) { bestD = d; best = b; }
          }
        }
        if (!best) return null;
        // recompute the pure pixel distance for the threshold
        let minPx = Infinity;
        for (const [x, z] of [[best.a.x, best.a.z], [best.b.x, best.b.z], [(best.a.x + best.b.x) / 2, (best.a.z + best.b.z) / 2]] as const) {
          const [sx, sy] = px(x, best.a.y, z);
          minPx = Math.min(minPx, Math.hypot(sx - clientX, sy - clientY));
        }
        return minPx <= 26 ? best.position : null;
      },
    };
    apiRef.current = api;
    return () => { if (apiRef.current === api) apiRef.current = null; };
  }, [apiRef, table, n, focusRef]);

  // ----- per-instance buffers (only when data / selection change) -----
  useLayoutEffect(() => {
    const nodes = nodesRef.current, rungs = rungsRef.current, beads = beadsRef.current;
    if (!nodes || !rungs || !beads) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3();
    const beadColor = new THREE.Color("#f0faff");
    let bead = 0;
    for (const b of table) {
      const changed = draftChanged.has(b.position) || savedChanged.has(b.position);
      const selected = selectedPosition === b.position;
      const r = selected ? NODE_R_SELECTED : changed ? NODE_R_CHANGED : NODE_R;
      const ca = colorOf(b.letterA), cb = colorOf(b.letterB);
      m.makeScale(r, r, r).setPosition(b.a.x, b.a.y, b.a.z);
      nodes.setMatrixAt(b.index, m); nodes.setColorAt(b.index, ca);
      m.makeScale(r, r, r).setPosition(b.b.x, b.b.y, b.b.z);
      nodes.setMatrixAt(n + b.index, m); nodes.setColorAt(n + b.index, cb);

      A.set(b.a.x, b.a.y, b.a.z); B.set(b.b.x, b.b.y, b.b.z);
      mid.copy(A).add(B).multiplyScalar(0.5);
      dir.copy(B).sub(A);
      const len = dir.length();
      dir.normalize();
      q.setFromUnitVectors(yAxis, dir);
      const thick = selected ? 0.05 : 0.026;
      p.copy(A).add(mid).multiplyScalar(0.5);
      m.compose(p, q, s.set(thick, len / 2, thick));
      rungs.setMatrixAt(b.index * 2, m); rungs.setColorAt(b.index * 2, ca);
      p.copy(B).add(mid).multiplyScalar(0.5);
      m.compose(p, q, s.set(thick, len / 2, thick));
      rungs.setMatrixAt(b.index * 2 + 1, m); rungs.setColorAt(b.index * 2 + 1, cb);

      const count = pairBondCount(b.letterA) ?? 0; // A-T: 2 bonds, C-G: 3 (shape cue)
      const fr = count === 2 ? [0.4, 0.6] : count === 3 ? [0.32, 0.5, 0.68] : [];
      for (const f of fr) {
        p.copy(A).lerp(B, f);
        m.makeScale(0.05, 0.05, 0.05).setPosition(p.x, p.y, p.z);
        beads.setMatrixAt(bead, m); beads.setColorAt(bead, beadColor);
        bead++;
      }
    }
    beads.count = bead;
    for (const mesh of [nodes, rungs, beads]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [table, draftChanged, savedChanged, selectedPosition, n]);

  // ----- sprites -----
  const sprites = useMemo(() => {
    const glows: SpriteItem[] = [];
    const shapes: SpriteItem[] = [];
    const letters: SpriteItem[] = [];
    const markers: SpriteItem[] = [];
    const was: SpriteItem[] = [];
    const white = new THREE.Color("#ffffff");
    const amber = new THREE.Color("#ffc857");
    const ice = new THREE.Color("#a8ecff");
    for (const b of table) {
      const dChanged = draftChanged.has(b.position);
      const sChanged = savedChanged.has(b.position);
      const selected = selectedPosition === b.position;
      const r = selected ? NODE_R_SELECTED : dChanged || sChanged ? NODE_R_CHANGED : NODE_R;
      const was0 = refLetters[b.index];
      for (const [pos, ch, strand] of [[b.a, b.letterA, "A"], [b.b, b.letterB, "B"]] as const) {
        glows.push({ x: pos.x, y: pos.y, z: pos.z, size: r * 6.2, cell: CELL.GLOW, color: colorOf(ch), alpha: selected ? 0.55 : dChanged || sChanged ? 0.45 : 0.22, lift: -r });
        shapes.push({ x: pos.x, y: pos.y, z: pos.z, size: r * 3.3, cell: shapeCell(ch), color: colorOf(ch), alpha: 0.95, lift: r * 1.1 });
        letters.push({ x: pos.x, y: pos.y, z: pos.z, size: r * 2.05, cell: letterCell(ch), color: white, alpha: 1, lift: r * 1.3 });
        if (dChanged) markers.push({ x: pos.x, y: pos.y, z: pos.z, size: r * 4.4, cell: CELL.DASHED, color: amber, alpha: 1, lift: r * 1.4 });
        else if (sChanged) markers.push({ x: pos.x, y: pos.y, z: pos.z, size: r * 4.4, cell: CELL.RING, color: ice, alpha: 1, lift: r * 1.4 });
        if (selected) markers.push({ x: pos.x, y: pos.y, z: pos.z, size: r * 5.6, cell: CELL.RETICLE, color: white, alpha: 1, lift: r * 1.5 });
        if (was0) {
          const wc = strand === "A" ? was0 : complementOf(was0) ?? "N";
          was.push({ x: pos.x, y: pos.y, z: pos.z, size: 0.4, cell: CELL.DASHED, color: colorOf(wc), alpha: 0.9, lift: r * 1.2, ox: 0.82, oy: 0 });
          was.push({ x: pos.x, y: pos.y, z: pos.z, size: 0.27, cell: letterCell(wc), color: white, alpha: 0.95, lift: r * 1.35, ox: 0.82, oy: 0 });
        }
      }
    }
    return { glows, shapes, letters, markers, was };
  }, [table, draftChanged, savedChanged, selectedPosition, refLetters]);

  useEffect(
    () => () => {
      sphere.dispose(); cyl.dispose(); nodeMat.dispose(); rungMat.dispose(); beadMat.dispose();
      backbone.a.dispose(); backbone.b.dispose();
      Object.values(tubeMats).forEach((m) => m.dispose());
    },
    [sphere, cyl, nodeMat, rungMat, beadMat, backbone, tubeMats],
  );

  return (
    <group ref={groupRef}>
      <mesh geometry={backbone.a} material={tubeMats.haloA} renderOrder={1} frustumCulled={false} />
      <mesh geometry={backbone.b} material={tubeMats.haloB} renderOrder={1} frustumCulled={false} />
      <mesh geometry={backbone.a} material={tubeMats.a} renderOrder={4} frustumCulled={false} />
      <mesh geometry={backbone.b} material={tubeMats.b} renderOrder={4} frustumCulled={false} />

      <instancedMesh key={`nodes-${n}`} ref={nodesRef} args={[sphere, nodeMat, n * 2]} frustumCulled={false} />
      <instancedMesh key={`rungs-${n}`} ref={rungsRef} args={[cyl, rungMat, n * 2]} frustumCulled={false} />
      <instancedMesh key={`beads-${n}`} ref={beadsRef} args={[sphere, beadMat, n * 3]} frustumCulled={false} />

      <Sprites items={sprites.glows} capacity={n * 2} warp={warp} additive renderOrder={3} backFade={0.5} depthTest={false} scaleMin={0.55} alphaMin={0.3} />
      <Sprites items={sprites.shapes} capacity={n * 2} warp={warp} renderOrder={6} backFade={0.25} scaleMin={0.2} alphaMin={0} />
      <Sprites items={sprites.letters} capacity={n * 2} warp={warp} renderOrder={7} backFade={0.25} scaleMin={0.2} alphaMin={0} />
      <Sprites items={sprites.markers} capacity={n * 6} warp={warp} renderOrder={8} backFade={0.4} scaleMin={0.35} alphaMin={0.55} />
      <Sprites items={sprites.was} capacity={n * 4} warp={warp} renderOrder={9} backFade={0.3} scaleMin={0.3} alphaMin={0} />
      {flashRef && <EditFlash flashRef={flashRef} focusRef={focusRef} n={n} />}
    </group>
  );
});
