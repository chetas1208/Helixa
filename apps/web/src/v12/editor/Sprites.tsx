import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { WARP_GLSL } from "./warpShader";
import type { WarpUniforms } from "./warpShader";

/**
 * Atlas cells. Every nucleotide gets a letter AND a distinct shape (never colour alone):
 * A = triangle, C = circle, G = square, T = diamond, unknown = hexagon.
 */
export const CELL = { A: 0, C: 1, G: 2, T: 3, N: 4, RING: 5, DASHED: 6, RETICLE: 7, GLOW: 8, TRI: 9, CIRCLE: 10, SQUARE: 11, DIAMOND: 12, HEX: 13 } as const;
const CELLS = 14;
const CELL_PX = 128;

export function letterCell(ch: string): number {
  switch (ch) {
    case "A": return CELL.A;
    case "C": return CELL.C;
    case "G": return CELL.G;
    case "T": return CELL.T;
    default: return CELL.N;
  }
}
export function shapeCell(ch: string): number {
  switch (ch) {
    case "A": return CELL.TRI;
    case "C": return CELL.CIRCLE;
    case "G": return CELL.SQUARE;
    case "T": return CELL.DIAMOND;
    default: return CELL.HEX;
  }
}

let atlasCache: THREE.CanvasTexture | null = null;

/** One shared canvas atlas (letters, rings, reticle, glow, base shapes). Generated procedurally, no assets. */
export function getAtlas(): THREE.CanvasTexture {
  if (atlasCache) return atlasCache;
  const canvas = document.createElement("canvas");
  canvas.width = CELL_PX * CELLS;
  canvas.height = CELL_PX;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const cx = (i: number) => i * CELL_PX + CELL_PX / 2;
    const cy = CELL_PX / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 78px Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
    ["A", "C", "G", "T", "N"].forEach((ch, i) => {
      ctx.lineWidth = 12;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(3,6,18,0.95)";
      ctx.strokeText(ch, cx(i), cy + 4);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(ch, cx(i), cy + 4);
    });
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(cx(CELL.RING), cy, 50, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([16, 12]);
    ctx.beginPath(); ctx.arc(cx(CELL.DASHED), cy, 50, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    const o = CELL.RETICLE * CELL_PX;
    const m = 14, L = 30;
    const seg = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => { ctx.beginPath(); ctx.moveTo(o + x1, y1); ctx.lineTo(o + x2, y2); ctx.lineTo(o + x3, y3); ctx.stroke(); };
    seg(m, m + L, m, m, m + L, m);
    seg(CELL_PX - m - L, m, CELL_PX - m, m, CELL_PX - m, m + L);
    seg(m, CELL_PX - m - L, m, CELL_PX - m, m + L, CELL_PX - m);
    seg(CELL_PX - m - L, CELL_PX - m, CELL_PX - m, CELL_PX - m, CELL_PX - m, CELL_PX - m - L);
    const g = ctx.createRadialGradient(cx(CELL.GLOW), cy, 2, cx(CELL.GLOW), cy, CELL_PX / 2);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.3, "rgba(255,255,255,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(CELL.GLOW * CELL_PX, 0, CELL_PX, CELL_PX);

    // base shapes: tinted glass fill + crisp rim
    const shape = (cell: number, path: (x: number, y: number) => void) => {
      const x = cx(cell);
      ctx.beginPath(); path(x, cy);
      ctx.fillStyle = "rgba(255,255,255,0.34)";
      ctx.fill();
      ctx.lineWidth = 8; ctx.lineJoin = "round"; ctx.strokeStyle = "#ffffff";
      ctx.stroke();
    };
    shape(CELL.TRI, (x, y) => { ctx.moveTo(x, y - 52); ctx.lineTo(x + 52, y + 40); ctx.lineTo(x - 52, y + 40); ctx.closePath(); });
    shape(CELL.CIRCLE, (x, y) => { ctx.arc(x, y, 49, 0, Math.PI * 2); });
    shape(CELL.SQUARE, (x, y) => { ctx.roundRect?.(x - 44, y - 44, 88, 88, 14); if (!ctx.roundRect) ctx.rect(x - 44, y - 44, 88, 88); });
    shape(CELL.DIAMOND, (x, y) => { ctx.moveTo(x, y - 56); ctx.lineTo(x + 56, y); ctx.lineTo(x, y + 56); ctx.lineTo(x - 56, y); ctx.closePath(); });
    shape(CELL.HEX, (x, y) => { for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; const px = x + Math.cos(a) * 50, py = y + Math.sin(a) * 50; if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.closePath(); });
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  atlasCache = tex;
  return tex;
}

export interface SpriteItem {
  x: number; y: number; z: number; // local, UNWARPED helix coordinates
  size: number;
  cell: number;
  color: THREE.Color;
  alpha?: number;
  lift?: number; // toward the camera, local units
  /** Offset in view-space units (x right, y up), scaled with the helix; used for "was" badges. */
  ox?: number;
  oy?: number;
}

const VERT = /* glsl */ `
  attribute float aCell;
  attribute vec3 aTint;
  attribute float aAlpha;
  attribute float aLift;
  attribute vec2 aOff;
  uniform float uCells;
  uniform float uBackFade;
  uniform float uScaleMin;
  uniform float uAlphaMin;
  ${WARP_GLSL}
  varying vec2 vUv;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    float cyU = instanceMatrix[3].y;
    float fw = focusW(cyU);
    vec3 c3 = vec3(instanceMatrix[3].x, warpY(cyU), instanceMatrix[3].z);
    vec4 centre = modelViewMatrix * vec4(c3, 1.0);
    vec4 origin = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float gs = length(modelViewMatrix[0].xyz);
    float size = length(instanceMatrix[0].xyz) * gs * mix(uScaleMin, 1.0, fw);
    float rel = (centre.z - origin.z) / max(gs, 0.0001);
    vec4 vp = centre;
    vp.xy += position.xy * size + aOff * gs * mix(uScaleMin, 1.0, fw);
    vp.z += aLift * gs;
    vUv = vec2((aCell + uv.x) / uCells, uv.y);
    vTint = aTint;
    vAlpha = aAlpha * mix(uAlphaMin, 1.0, fw) * mix(uBackFade, 1.0, smoothstep(-1.3, 1.1, rel));
    gl_Position = projectionMatrix * vp;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uAtlas, vUv);
    gl_FragColor = vec4(t.rgb * vTint, t.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
    #include <colorspace_fragment>
  }
`;

export interface SpritesProps {
  items: SpriteItem[];
  capacity: number;
  warp: WarpUniforms;
  additive?: boolean;
  renderOrder?: number;
  backFade?: number;
  depthTest?: boolean;
  /** Scale at the far end of the context region (1 = no shrink). */
  scaleMin?: number;
  /** Alpha at the far end of the context region (0 = only visible in focus). */
  alphaMin?: number;
}

/** Camera-facing instanced sprites. Buffers update only when `items` change; warp/focus live in the shader. */
export function Sprites({ items, capacity, warp, additive = false, renderOrder = 5, backFade = 0.35, depthTest = true, scaleMin = 1, alphaMin = 1 }: SpritesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute("aCell", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    g.setAttribute("aTint", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    g.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    g.setAttribute("aLift", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    g.setAttribute("aOff", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
    return g;
  }, [capacity]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        depthTest,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uAtlas: { value: getAtlas() }, uCells: { value: CELLS }, uBackFade: { value: backFade }, uScaleMin: { value: scaleMin }, uAlphaMin: { value: alphaMin }, ...warp },
      }),
    [additive, backFade, depthTest, scaleMin, alphaMin, warp],
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const A = (k: string) => geometry.getAttribute(k) as THREE.InstancedBufferAttribute;
    const cell = A("aCell"), tint = A("aTint"), alpha = A("aAlpha"), lift = A("aLift"), off = A("aOff");
    const count = Math.min(items.length, capacity);
    for (let i = 0; i < count; i++) {
      const it = items[i];
      m.makeScale(it.size, it.size, it.size).setPosition(it.x, it.y, it.z);
      mesh.setMatrixAt(i, m);
      cell.setX(i, it.cell);
      tint.setXYZ(i, it.color.r, it.color.g, it.color.b);
      alpha.setX(i, it.alpha ?? 1);
      lift.setX(i, it.lift ?? 0);
      off.setXY(i, it.ox ?? 0, it.oy ?? 0);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    for (const a of [cell, tint, alpha, lift, off]) a.needsUpdate = true;
  }, [items, capacity, geometry]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  return <instancedMesh ref={meshRef} args={[geometry, material, capacity]} frustumCulled={false} renderOrder={renderOrder} />;
}
