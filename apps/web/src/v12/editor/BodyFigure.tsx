import { forwardRef, useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildBodyGeometry, sampleSurface } from "./bodyGeometry";

/**
 * Neutral "holographic scan" human figure (procedural, illustrative only). It NEVER changes with sequence
 * edits: no prop carries genomic data, by design. No face, no organs, no hotspots.
 *  1) a near-transparent dark glass shell (front-most layer only) with a strong fresnel rim,
 *  2) fine horizontal contour / scan lines in glacial cyan,
 *  3) a sparse, deterministic particle skin.
 * When the DNA draft changes, a fast scan sweep runs head to toe (`pulseRef` = clock time it starts). It is an
 * acknowledgement that the edit was received, not a phenotype: geometry and colour mapping never change.
 */
export const BODY_PULSE_S = 0.85;
const SHELL_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    vY = position.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const SHELL_FRAG = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uRim;
  uniform vec3 uRim2;
  uniform float uFade;
  uniform float uTime;
  uniform float uPulse;
  varying vec3 vN;
  varying vec3 vView;
  varying float vY;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vView);
    float ndv = max(dot(n, v), 0.0);
    float fres = pow(1.0 - ndv, 2.2);
    // soft key from upper-left, cool back light from the right
    float key = clamp(dot(n, normalize(vec3(-0.5, 0.7, 0.7))) * 0.5 + 0.5, 0.0, 1.0);
    float back = pow(clamp(dot(n, normalize(vec3(0.8, 0.1, -0.5))) * 0.5 + 0.5, 0.0, 1.0), 3.0);
    vec3 col = uBase * (0.25 + 0.55 * key);
    col += uRim * fres * 1.15 + uRim2 * back * fres * 0.8;
    // fine contour lines (every ~0.16 units) with a slow scan band travelling up the figure
    float l = abs(fract(vY * 6.0) - 0.5);
    float line = smoothstep(0.44, 0.5, l);
    float band = exp(-pow((fract(uTime * 0.06) * 11.0 - 5.5 - vY) * 1.6, 2.0));
    col += uRim * line * (0.10 + 0.5 * fres) + uRim * band * 0.35;
    // edit-received sweep: a bright band running crown -> soles, with a short trail above it
    float sweep = 0.0;
    float lift = 0.0;
    if (uPulse >= 0.0) {
      float yb = mix(5.4, -5.4, uPulse);
      float d = vY - yb;
      sweep = exp(-d * d * 3.0) + 0.35 * exp(-max(d, 0.0) * 1.4) * step(0.0, d) * (1.0 - uPulse);
      lift = (1.0 - uPulse) * 0.35;
      col += vec3(0.78, 0.96, 1.0) * sweep * 1.5 + uRim * fres * lift;
    }
    float alpha = (0.1 + fres * 0.8 + line * 0.14 + band * 0.18 + sweep * 0.6 + lift * fres) * (0.18 + 0.82 * smoothstep(-5.15, -3.2, vY)) * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

const POINT_VERT = /* glsl */ `
  uniform float uSize;
  uniform float uFade;
  uniform float uPulse;
  varying float vA;
  varying float vB;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float b = 0.0;
    if (uPulse >= 0.0) { float d = position.y - mix(5.4, -5.4, uPulse); b = exp(-d * d * 2.0); }
    vB = b;
    gl_PointSize = uSize * (1.0 + 1.6 * b) * (14.0 / max(-mv.z, 1.0));
    vA = uFade * (0.25 + 0.75 * smoothstep(-5.1, -2.5, position.y));
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying float vA;
  varying float vB;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.1, length(d));
    gl_FragColor = vec4(mix(vec3(0.55, 0.88, 1.0), vec3(1.0), vB), a * vA * (0.7 + 0.3 * vB));
    #include <colorspace_fragment>
  }
`;

export type FadeSetter = MutableRefObject<((v: number) => void) | null>;

export const BodyFigure = forwardRef<THREE.Group, { fadeRef?: FadeSetter; reducedMotion?: boolean; pulseRef?: MutableRefObject<number> }>(function BodyFigure({ fadeRef, reducedMotion, pulseRef }, ref) {
  const geometry = useMemo(() => buildBodyGeometry(), []);
  const points = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sampleSurface(geometry, 2600), 3));
    return g;
  }, [geometry]);

  const depthMat = useMemo(() => new THREE.MeshBasicMaterial({ colorWrite: false }), []);
  const shellMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uBase: { value: new THREE.Color("#0c1a3a") },
          uRim: { value: new THREE.Color("#69dcff") },
          uRim2: { value: new THREE.Color("#8f6bff") },
          uFade: { value: 1 },
          uTime: { value: 0 },
          uPulse: { value: -1 },
        },
      }),
    [],
  );
  const pointMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: POINT_VERT,
        fragmentShader: POINT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uSize: { value: 3.2 }, uFade: { value: 1 }, uPulse: { value: -1 } },
      }),
    [],
  );

  useEffect(() => {
    if (fadeRef) fadeRef.current = (v: number) => { shellMat.uniforms.uFade.value = v; pointMat.uniforms.uFade.value = v; };
    return () => { if (fadeRef) fadeRef.current = null; };
  }, [fadeRef, shellMat, pointMat]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (!reducedMotion) shellMat.uniforms.uTime.value = now;
    const p = pulseRef ? (now - pulseRef.current) / BODY_PULSE_S : -1;
    const v = p >= 0 && p <= 1 ? p : -1;
    if (shellMat.uniforms.uPulse.value !== v) { shellMat.uniforms.uPulse.value = v; pointMat.uniforms.uPulse.value = v; }
  });

  useEffect(
    () => () => { geometry.dispose(); points.dispose(); depthMat.dispose(); shellMat.dispose(); pointMat.dispose(); },
    [geometry, points, depthMat, shellMat, pointMat],
  );

  return (
    <group ref={ref} name="illustrative-body-figure">
      {/* pass 1 writes depth only, pass 2 draws the glass shell where it is front-most (no inner double layers) */}
      <mesh geometry={geometry} material={depthMat} renderOrder={1} />
      <mesh geometry={geometry} material={shellMat} renderOrder={2} />
      <points geometry={points} material={pointMat} renderOrder={3} frustumCulled={false} />
    </group>
  );
});

/** Static pedestal under the figure (does not rotate with it). */
export function BodyPedestal({ fadeRef }: { fadeRef?: FadeSetter }) {
  const ring = useMemo(() => new THREE.RingGeometry(1.9, 1.94, 128), []);
  const ring2 = useMemo(() => new THREE.RingGeometry(2.55, 2.57, 128), []);
  const soft = useMemo(() => new THREE.CircleGeometry(3.4, 64), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#69dcff", transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }), []);
  const softMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uA: { value: 0.22 } },
        vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
        fragmentShader: "uniform float uA; varying vec2 vP; void main(){ float r = length(vP)/3.4; float a = pow(1.0-clamp(r,0.0,1.0), 2.2)*uA; gl_FragColor = vec4(vec3(0.25,0.55,1.0)*a, a); }",
      }),
    [],
  );
  useEffect(() => {
    if (fadeRef) fadeRef.current = (v: number) => { ringMat.opacity = 0.45 * v; softMat.uniforms.uA.value = 0.22 * v; };
    return () => { if (fadeRef) fadeRef.current = null; };
  }, [fadeRef, ringMat, softMat]);
  useEffect(() => () => { ring.dispose(); ring2.dispose(); soft.dispose(); ringMat.dispose(); softMat.dispose(); }, [ring, ring2, soft, ringMat, softMat]);
  return (
    <group position={[0, -5.12, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={soft} material={softMat} renderOrder={0} />
      <mesh geometry={ring} material={ringMat} />
      <mesh geometry={ring2} material={ringMat} />
    </group>
  );
}
