/**
 * Node-safe camera framing. AnatomyStage owns a private camera; these helpers never
 * touch the shell / helix camera.
 */
import type { MeshBounds } from "./types";

export interface CameraPose {
  position: [number, number, number];
  lookAt: [number, number, number];
}

export const BODY_HOME: CameraPose = {
  position: [0, 0.35, 15.4],
  lookAt: [0, 0.05, 0],
};

export function boundsCenter(b: MeshBounds): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

export function boundsExtent(b: MeshBounds): number {
  const dx = b.max[0] - b.min[0];
  const dy = b.max[1] - b.min[1];
  const dz = b.max[2] - b.min[2];
  return Math.max(dx, dy, dz, 0.2);
}

/** Front-biased pose that frames `bounds` in a perspective camera of `fovDeg`. */
export function poseForBounds(bounds: MeshBounds, fovDeg: number, anchor?: [number, number, number]): CameraPose {
  const look = anchor ?? boundsCenter(bounds);
  const extent = boundsExtent(bounds);
  const half = (fovDeg * Math.PI) / 360;
  const dist = Math.max(1.4, (extent * 0.72) / Math.tan(half));
  const z = look[2] + dist;
  return {
    position: [look[0] * 0.15, look[1] + extent * 0.08, z],
    lookAt: look,
  };
}

export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const u = Math.min(1, Math.max(0, t));
  const mix = (p: [number, number, number], q: [number, number, number]): [number, number, number] => [
    p[0] + (q[0] - p[0]) * u,
    p[1] + (q[1] - p[1]) * u,
    p[2] + (q[2] - p[2]) * u,
  ];
  return { position: mix(a.position, b.position), lookAt: mix(a.lookAt, b.lookAt) };
}

/** Pointer in CSS pixels (origin top-left of the canvas) → NDC of `rect`, or null if outside. */
export function pointerToRectNdc(
  cssX: number,
  cssY: number,
  rect: { x: number; y: number; width: number; height: number },
): [number, number] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (cssX < rect.x || cssY < rect.y || cssX > rect.x + rect.width || cssY > rect.y + rect.height) return null;
  const nx = ((cssX - rect.x) / rect.width) * 2 - 1;
  const ny = -(((cssY - rect.y) / rect.height) * 2 - 1);
  return [nx || 0, ny || 0];
}
