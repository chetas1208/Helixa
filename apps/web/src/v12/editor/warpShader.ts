import * as THREE from "three";
import { FOCUS_R0, FOCUS_R1 } from "./helixGeometry";
import type { WarpParams } from "./helixGeometry";

/** Uniform bundle shared by every material of one helix (mirrors helixGeometry.makeWarp/warpY/focusWeight). */
export interface WarpUniforms {
  uWarp: { value: THREE.Vector4 }; // focusY, K, sigma, F(ymin)
  uWarp2: { value: THREE.Vector3 }; // ymin, scale, 0
  uFocus: { value: THREE.Vector2 }; // R0, R1
}

export function createWarpUniforms(): WarpUniforms {
  return {
    uWarp: { value: new THREE.Vector4(0, 0, 1, 0) },
    uWarp2: { value: new THREE.Vector3(0, 1, 0) },
    uFocus: { value: new THREE.Vector2(FOCUS_R0, FOCUS_R1) },
  };
}

export function setWarp(u: WarpUniforms, p: WarpParams): void {
  u.uWarp.value.set(p.c, p.k, p.sigma, p.fMin);
  u.uWarp2.value.set(p.yMin, p.scale, 0);
}

/** GLSL: same maths as the TS helpers. Requires uniforms uWarp, uWarp2, uFocus. */
export const WARP_GLSL = /* glsl */ `
  uniform vec4 uWarp;
  uniform vec3 uWarp2;
  uniform vec2 uFocus;
  float warpY(float y) {
    return uWarp2.x + (y + uWarp.y * uWarp.z * tanh((y - uWarp.x) / uWarp.z) - uWarp.w) * uWarp2.y;
  }
  float focusW(float y) {
    float t = clamp((abs(y - uWarp.x) - uFocus.x) / (uFocus.y - uFocus.x), 0.0, 1.0);
    return 1.0 - t * t * (3.0 - 2.0 * t);
  }
`;

/**
 * Patch a MeshStandardMaterial for instanced helix parts: shrink toward a dot outside the focus window and move the
 * instance CENTRE along the warped axis (vertices keep their shape, so spheres never stretch).
 * mode 0 = scale all axes (nodes, beads); 1 = scale x/z only (rungs: length is their own).
 */
export function patchInstancedForWarp(mat: THREE.MeshStandardMaterial, u: WarpUniforms, minScale: number, mode: 0 | 1, glow: number): void {
  const glowU = { value: glow };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, { uGlow: glowU, uMinScale: { value: minScale } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${WARP_GLSL}\nuniform float uMinScale;`)
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = vec3( position );
#ifdef USE_INSTANCING
  float fwc = mix(uMinScale, 1.0, focusW(instanceMatrix[3].y));
  ${mode === 0 ? "transformed *= fwc;" : "transformed.xz *= fwc;"}
#endif`,
      )
      .replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  mvPosition.y += warpY(instanceMatrix[3].y) - instanceMatrix[3].y;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uGlow;");
  };
  mat.customProgramCacheKey = () => `v12-warp-${mode}-${minScale}`;
}
