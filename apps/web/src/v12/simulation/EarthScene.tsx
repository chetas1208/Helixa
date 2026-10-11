/**
 * Procedural Earth + atmosphere with an abstract allele-frequency / population ribbon.
 * Runs INSIDE the persistent Canvas: it reads only zustand (earthSceneStore + the mutable liveClock), never
 * React Query or other contexts. Nothing here calls setState per frame; the ribbon's instance matrices are only
 * rewritten when the recorded frame changes. Illustrative visualization of model output, not a map or a prediction.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { frameIndexAt } from "./playbackClock";
import { liveClock, useEarthScene } from "./earthSceneStore";

const RIBBON_N = 120;
const RIBBON_R = 1.5;

const earthVert = /* glsl */ `
varying vec3 vObj; varying vec3 vNormalW; varying vec3 vView;
void main(){
  vObj = normalize(position);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const earthFrag = /* glsl */ `
precision highp float;
varying vec3 vObj; varying vec3 vNormalW; varying vec3 vView;
uniform vec3 uSun; uniform float uWarm; uniform float uWet; uniform float uTime; uniform float uDim;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){
  vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=.5;} return s; }
void main(){
  float h = fbm(vObj*2.4+3.1);
  float land = smoothstep(0.50,0.54,h);
  float lat = abs(vObj.y);
  vec3 ocean = mix(vec3(0.015,0.07,0.18), vec3(0.03,0.16,0.32), smoothstep(0.2,0.5,h));
  vec3 forest = mix(vec3(0.10,0.26,0.16), vec3(0.28,0.30,0.16), uWarm*0.8);
  vec3 desert = vec3(0.42,0.34,0.20);
  vec3 grass = mix(forest, desert, smoothstep(0.55,0.72,h)*0.7);
  vec3 ice = vec3(0.82,0.88,0.94);
  vec3 ground = mix(grass, ice, smoothstep(0.78 - uWarm*0.1,0.92,lat));
  vec3 col = mix(ocean, ground, land);
  col = mix(col, ice, smoothstep(0.86,0.97,lat)*(1.0-land*0.3));
  float cl = fbm(vObj*3.6 + vec3(uTime*0.012, 0.0, uTime*0.008) + 11.0);
  float cover = smoothstep(0.62 - uWet*0.16, 0.86, cl);
  col = mix(col, vec3(0.93,0.95,0.98), cover*0.82);
  vec3 N = normalize(vNormalW);
  float d = dot(N, normalize(uSun));
  float lit = smoothstep(-0.12, 0.35, d);
  vec3 sunTint = mix(vec3(0.80,0.90,1.0), vec3(1.0,0.86,0.68), uWarm);
  vec3 night = col*vec3(0.035,0.05,0.10);
  vec3 day = col*(0.18+0.95*max(d,0.0))*sunTint;
  vec3 c = mix(night, day, lit);
  float fres = pow(1.0 - max(dot(N, normalize(vView)),0.0), 3.0);
  c += vec3(0.18,0.42,0.95)*fres*0.55*(0.35+lit);
  c *= uDim;
  gl_FragColor = vec4(c,1.0);
}`;

const atmoFrag = /* glsl */ `
precision highp float;
varying vec3 vNormalW; varying vec3 vView; uniform vec3 uSun; uniform float uWarm;
void main(){
  vec3 N = normalize(vNormalW);
  float rim = pow(1.0 - abs(dot(N, normalize(vView))), 2.6);
  float lit = 0.35 + 0.65*smoothstep(-0.4, 0.5, dot(N, normalize(uSun)));
  vec3 c = mix(vec3(0.20,0.50,1.0), vec3(0.95,0.62,0.40), uWarm*0.5);
  gl_FragColor = vec4(c, rim*lit*0.85);
}`;
const atmoVert = /* glsl */ `
varying vec3 vNormalW; varying vec3 vView;
void main(){ vNormalW = normalize(mat3(modelMatrix)*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vView = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`;

function Stars({ count }: { count: number }) {
  const geo = useMemo(() => {
    // Deterministic starfield (seeded LCG): identical on every mount, no per-render re-roll.
    let s = 1234567;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = rnd() * 2 - 1;
      const t = rnd() * Math.PI * 2;
      const r = 14 + rnd() * 10;
      const q = Math.sqrt(1 - u * u);
      pos.set([r * q * Math.cos(t), r * u, r * q * Math.sin(t)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [count]);
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.045} color="#b6c8ff" transparent opacity={0.7} sizeAttenuation depthWrite={false} />
    </points>
  );
}

const FOCAL = new THREE.Color("#5eead4");
const OTHER = new THREE.Color("#8b7cf6");
const GONE = new THREE.Color("#64748b");
const IDLE = new THREE.Color("#475569");

function Ribbon({ reduced }: { reduced: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const lastKey = useRef("");
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const { frames, runKey, popMax } = useEarthScene.getState();
    const idx = runKey ? frameIndexAt(frames, liveClock.visibleYear) : -1;
    const key = `${runKey}|${idx}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      const f = idx >= 0 ? frames[idx] : null;
      const p = f ? f.allele_frequency : 0;
      const lit = f ? Math.round(p * RIBBON_N) : 0;
      const popScale = f ? (f.extinct ? 0.04 : 0.25 + 0.75 * Math.min(1, f.population_size / popMax)) : 0.12;
      for (let i = 0; i < RIBBON_N; i++) {
        const a = (i / RIBBON_N) * Math.PI * 2;
        const focal = i < lit;
        const wobble = f && !f.extinct ? 0.04 * Math.sin(i * 0.37) : 0; // fixed texture, not data
        // Focal segments are taller, other-allele segments shorter: colour is never the only cue.
        const h = (focal ? 0.16 : 0.06) * (f ? popScale : 0.5) + 0.01;
        dummy.position.set(Math.cos(a) * RIBBON_R, wobble, Math.sin(a) * RIBBON_R);
        dummy.rotation.set(0, -a, 0);
        dummy.scale.set(0.03, h, (Math.PI * 2 * RIBBON_R) / RIBBON_N * 0.78);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        m.setColorAt(i, !f ? IDLE : f.extinct ? GONE : focal ? FOCAL : OTHER);
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (group.current && !reduced) group.current.rotation.y += delta * 0.05;
  });

  return (
    <group ref={group} rotation={[0.38, 0, 0.12]}>
      <instancedMesh ref={mesh} args={[undefined, undefined, RIBBON_N]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.45} metalness={0.1} emissive="#1e3a5f" emissiveIntensity={0.55} />
      </instancedMesh>
    </group>
  );
}

function Planet({ reduced }: { reduced: boolean }) {
  const earth = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({ uSun: { value: new THREE.Vector3(4, 1.6, 3) }, uWarm: { value: 0.5 }, uWet: { value: 0.3 }, uTime: { value: 0 }, uDim: { value: 1 } }),
    [],
  );
  const atmoUniforms = useMemo(() => ({ uSun: uniforms.uSun, uWarm: uniforms.uWarm }), [uniforms]);
  useFrame((_, delta) => {
    const { preview, runKey, frames } = useEarthScene.getState();
    uniforms.uWarm.value += (preview.warmth - uniforms.uWarm.value) * Math.min(1, delta * 4); // lighting preview only
    uniforms.uWet.value += (preview.wetness - uniforms.uWet.value) * Math.min(1, delta * 4);
    if (!reduced) {
      uniforms.uTime.value += delta;
      if (earth.current) earth.current.rotation.y += delta * 0.03;
    }
    const idx = runKey ? frameIndexAt(frames, liveClock.visibleYear) : -1;
    const extinct = idx >= 0 && frames[idx].extinct;
    uniforms.uDim.value += ((extinct ? 0.55 : 1) - uniforms.uDim.value) * Math.min(1, delta * 3);
  });
  return (
    <group>
      <mesh ref={earth} rotation={[0.25, 0, 0]}>
        <sphereGeometry args={[1, 64, 48]} />
        <shaderMaterial vertexShader={earthVert} fragmentShader={earthFrag} uniforms={uniforms} />
      </mesh>
      <mesh scale={1.07}>
        <sphereGeometry args={[1, 48, 36]} />
        <shaderMaterial vertexShader={atmoVert} fragmentShader={atmoFrag} uniforms={atmoUniforms} transparent side={THREE.BackSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

export function EarthScene() {
  const reduced = useEarthScene((s) => s.reducedMotion);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(0, 0.8, 5.0);
    camera.lookAt(0, 0, 0);
  }, [camera]);
  return (
    <>
      <color attach="background" args={["#03060d"]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 1.6, 3]} intensity={1.6} color="#dbeafe" />
      <Stars count={reduced ? 250 : 650} />
      <Planet reduced={reduced} />
      <Ribbon reduced={reduced} />
      <OrbitControls enablePan={false} enableDamping={!reduced} dampingFactor={0.08} minDistance={2.6} maxDistance={8} rotateSpeed={0.55} zoomSpeed={0.6} />
    </>
  );
}
