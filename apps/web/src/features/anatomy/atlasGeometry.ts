import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { HIT_DEFS } from "./hitTable";
import { ellipsoidGeometry, loftEllipses, sampleSurface } from "./loft";
import { qualityPreset } from "./quality";
import type { AnatomyQuality } from "./types";

export interface PartMesh {
  asset_id: string;
  anatomy_id: string;
  pickRank: "region" | "organ" | "digit";
  geometry: THREE.BufferGeometry;
}

const SHELL_ASSETS = new Set([
  "mesh:head", "mesh:face", "mesh:neck", "mesh:thorax", "mesh:abdomen", "mesh:pelvis", "mesh:spine",
  "mesh:arm_L", "mesh:arm_R", "mesh:hand_L", "mesh:hand_R", "mesh:leg_L", "mesh:leg_R", "mesh:foot_L", "mesh:foot_R",
  "mesh:shoulder_L", "mesh:shoulder_R",
]);

export function buildPartGeometry(assetId: string, quality: AnatomyQuality): THREE.BufferGeometry | null {
  const def = HIT_DEFS.find((h) => h.asset_id === assetId);
  if (!def || def.asset_id === "mesh:body") return null;
  const q = qualityPreset(quality);
  const radial = def.pickRank === "organ" || def.pickRank === "digit" ? q.organRadial : q.radial;
  if (def.shape.kind === "ellipsoid") return ellipsoidGeometry(def.shape.center, def.shape.radii, radial);
  return loftEllipses(def.shape.sections, { radial, perSegment: q.perSegment, cap: def.shape.cap ?? q.cap });
}

export function buildAtlasParts(quality: AnatomyQuality): PartMesh[] {
  const parts: PartMesh[] = [];
  for (const def of HIT_DEFS) {
    const geometry = buildPartGeometry(def.asset_id, quality);
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    parts.push({ asset_id: def.asset_id, anatomy_id: def.anatomy_id, pickRank: def.pickRank, geometry });
  }
  return parts;
}

/** Merged exterior shell for the particle skin (never used as a pick target). */
export function buildShellMerge(parts: PartMesh[]): THREE.BufferGeometry | null {
  const geos = parts.filter((p) => SHELL_ASSETS.has(p.asset_id)).map((p) => {
    const g = p.geometry.clone();
    g.deleteAttribute("uv");
    return g;
  });
  if (geos.length === 0) return null;
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return merged;
}

export function buildParticleCloud(shell: THREE.BufferGeometry | null, count: number): THREE.BufferGeometry | null {
  if (!shell || count <= 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(sampleSurface(shell, count), 3));
  return g;
}

export function isShellAsset(assetId: string): boolean {
  return SHELL_ASSETS.has(assetId);
}
