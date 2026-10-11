import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { SceneClock } from "../../scenes/SceneClock";
import { useSession } from "../state/session";
import type { TabId } from "../types";

/**
 * Ambient DNA atmosphere. Purely decorative and abstract (no nucleotide identity, no data).
 *  - Timing comes from SceneClock: continuous rotation, a 300 s style cycle with a ~30 s morph.
 *  - Only the geometry/colour parameters of the *style* come from SceneClock; colours are mapped
 *    to this product's glacial palette below.
 *  - Level per tab: Evolution/Library = quiet backdrop at the right; Editor/Simulation = off
 *    (the editor owns the real helix, the simulation owns the globe).
 *  - No React state is touched per frame. Matrices are rebuilt only while the morph moves them.
 */

const LEVEL: Record<TabId, number> = { editor: 0, evolution: 1, simulation: 0, library: 1 };
const DUST_LEVEL: Record<TabId, number> = { editor: 0.5, evolution: 1, simulation: 0.35, library: 1 };

const PAIRS = 38;
const BACKBONE_POINTS = 168;
const HEIGHT = 13.5;
const BASE_RADIUS = 1.25;
const BASE_TURNS = 3.4;
const TAU = Math.PI * 2;
const REDUCED_ANGLE = 0.6;

// Five style palettes in the product's range (cyan -> cobalt -> indigo -> amethyst), matching SceneClock's cycle count.
const STYLE_COLORS = [
  ["#7fe3ff", "#5a86ff"],
  ["#bd96ff", "#8678ff"],
  ["#5a86ff", "#7fe3ff"],
  ["#8678ff", "#bd96ff"],
  ["#66d0ff", "#9a86ff"],
] as const;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function AmbientBackdrop() {
  const groupRef = useRef<THREE.Group>(null);
  const helixRef = useRef<THREE.Group>(null);
  const dustRef = useRef<THREE.Points>(null);
  const beadsA = useRef<THREE.InstancedMesh>(null);
  const beadsB = useRef<THREE.InstancedMesh>(null);
  const rungs = useRef<THREE.InstancedMesh>(null);
  const viewport = useThree((s) => s.viewport);

  const resources = useMemo(() => {
    const rand = mulberry32(0xa11ce);
    const dustPos = new Float32Array(170 * 3);
    for (let i = 0; i < 170; i++) {
      dustPos[i * 3] = (rand() - 0.5) * 46;
      dustPos[i * 3 + 1] = (rand() - 0.5) * 28;
      dustPos[i * 3 + 2] = -6 - rand() * 22;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ color: "#9fb8e8", size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false });

    const bead = new THREE.SphereGeometry(0.075, 10, 8);
    const rung = new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1);
    const matA = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const matB = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const matR = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

    const mkBackbone = () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BACKBONE_POINTS * 3), 3));
      return geo;
    };
    const geoLineA = mkBackbone();
    const geoLineB = mkBackbone();
    const lineMatA = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const lineMatB = new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const lineA = new THREE.Line(geoLineA, lineMatA);
    const lineB = new THREE.Line(geoLineB, lineMatB);

    return {
      dustGeo, dustMat, bead, rung, matA, matB, matR, geoLineA, geoLineB, lineMatA, lineMatB, lineA, lineB,
      scratch: {
        o: new THREE.Object3D(),
        c1: new THREE.Color(), c2: new THREE.Color(), c3: new THREE.Color(), c4: new THREE.Color(),
        up: new THREE.Vector3(0, 1, 0),
        pa: new THREE.Vector3(), pb: new THREE.Vector3(), mid: new THREE.Vector3(), dir: new THREE.Vector3(),
        radius: -1, pitch: -1, level: 0, dust: 0, x: 0, y: 0, scale: 1,
      },
    };
  }, []);

  useEffect(() => {
    const r = resources;
    return () => {
      r.dustGeo.dispose(); r.dustMat.dispose(); r.bead.dispose(); r.rung.dispose();
      r.matA.dispose(); r.matB.dispose(); r.matR.dispose();
      r.geoLineA.dispose(); r.geoLineB.dispose(); r.lineMatA.dispose(); r.lineMatB.dispose();
    };
  }, [resources]);

  useFrame((_, delta) => {
    const g = groupRef.current;
    const helix = helixRef.current;
    const a = beadsA.current;
    const b = beadsB.current;
    const rg = rungs.current;
    if (!g || !helix || !a || !b || !rg) return;
    const s = resources.scratch;
    const state = useSession.getState();
    const tab = state.activeTab;
    const reduced = state.reducedMotion;
    const dt = Math.min(delta, 0.05);

    // Level easing (opacity), instantaneous under reduced motion.
    const lt = LEVEL[tab];
    const dtarget = DUST_LEVEL[tab];
    s.level = reduced ? lt : THREE.MathUtils.damp(s.level, lt, 2.4, dt);
    s.dust = reduced ? dtarget : THREE.MathUtils.damp(s.dust, dtarget, 2.4, dt);
    helix.visible = s.level > 0.004;
    g.visible = helix.visible || s.dust > 0.004;

    const params = SceneClock.computeVisualParams();

    // Dust: always very slow drift.
    if (dustRef.current) {
      dustRef.current.rotation.y = reduced ? 0.2 : params.rotationAngle * 0.06;
      resources.dustMat.opacity = 0.34 * s.dust;
    }
    if (!helix.visible) return;

    // Placement: right third on landscape, centred and smaller on portrait. Eased, not stepped.
    const landscape = viewport.aspect >= 1.15;
    const tx = landscape ? viewport.width * 0.3 : 0;
    const ty = landscape ? 0 : viewport.height * 0.2;
    const ts = landscape ? 1 : 0.62;
    s.x = THREE.MathUtils.damp(s.x, tx, 3, dt);
    s.y = THREE.MathUtils.damp(s.y, ty, 3, dt);
    s.scale = THREE.MathUtils.damp(s.scale, ts, 3, dt);
    helix.position.set(s.x, s.y, -3);
    helix.scale.setScalar(s.scale);
    helix.rotation.y = reduced ? REDUCED_ANGLE : params.rotationAngle;
    helix.rotation.z = -0.18;

    // Style blend: SceneClock phase 0.9 -> 1 is the ~30 s morph (smoothstep), then the next style takes over.
    const cur = STYLE_COLORS[params.cycleIndex % STYLE_COLORS.length];
    const nxt = STYLE_COLORS[(params.cycleIndex + 1) % STYLE_COLORS.length];
    let t = params.phase >= 0.9 ? (params.phase - 0.9) / 0.1 : 0;
    t = t * t * (3 - 2 * t);
    s.c1.set(cur[0]).lerp(s.c3.set(nxt[0]), t);
    s.c2.set(cur[1]).lerp(s.c4.set(nxt[1]), t);
    resources.matA.color.copy(s.c1);
    resources.matB.color.copy(s.c2);
    resources.lineMatA.color.copy(s.c1);
    resources.lineMatB.color.copy(s.c2);
    resources.matR.color.copy(s.c1).lerp(s.c2, 0.5);
    const lv = s.level;
    resources.matA.opacity = 0.5 * lv;
    resources.matB.opacity = 0.5 * lv;
    resources.matR.opacity = 0.2 * lv;
    resources.lineMatA.opacity = 0.34 * lv;
    resources.lineMatB.opacity = 0.34 * lv;

    // Rebuild instances only while the morph actually changes radius / pitch.
    if (Math.abs(params.radius - s.radius) > 0.0015 || Math.abs(params.pitch - s.pitch) > 0.0015) {
      s.radius = params.radius;
      s.pitch = params.pitch;
      const radius = BASE_RADIUS * (params.radius / 1.2);
      const turns = BASE_TURNS * (params.pitch / 0.8);
      const posA = resources.geoLineA.getAttribute("position") as THREE.BufferAttribute;
      const posB = resources.geoLineB.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < PAIRS; i++) {
        const u = i / (PAIRS - 1);
        const th = u * turns * TAU;
        const y = -HEIGHT / 2 + u * HEIGHT;
        s.pa.set(radius * Math.cos(th), y, radius * Math.sin(th));
        s.pb.set(radius * Math.cos(th + Math.PI), y, radius * Math.sin(th + Math.PI));
        s.o.rotation.set(0, 0, 0);
        s.o.scale.setScalar(1);
        s.o.position.copy(s.pa);
        s.o.updateMatrix();
        a.setMatrixAt(i, s.o.matrix);
        s.o.position.copy(s.pb);
        s.o.updateMatrix();
        b.setMatrixAt(i, s.o.matrix);
        // rung from A to B: a unit cylinder scaled to length and aligned to the A->B direction
        s.dir.subVectors(s.pb, s.pa);
        const len = s.dir.length();
        s.mid.addVectors(s.pa, s.pb).multiplyScalar(0.5);
        s.o.position.copy(s.mid);
        s.o.quaternion.setFromUnitVectors(s.up, s.dir.normalize());
        s.o.scale.set(1, len, 1);
        s.o.updateMatrix();
        rg.setMatrixAt(i, s.o.matrix);
      }
      for (let i = 0; i < BACKBONE_POINTS; i++) {
        const u = i / (BACKBONE_POINTS - 1);
        const th = u * turns * TAU;
        const y = -HEIGHT / 2 + u * HEIGHT;
        posA.setXYZ(i, radius * Math.cos(th), y, radius * Math.sin(th));
        posB.setXYZ(i, radius * Math.cos(th + Math.PI), y, radius * Math.sin(th + Math.PI));
      }
      a.instanceMatrix.needsUpdate = true;
      b.instanceMatrix.needsUpdate = true;
      rg.instanceMatrix.needsUpdate = true;
      posA.needsUpdate = true;
      posB.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      <points ref={dustRef} geometry={resources.dustGeo} material={resources.dustMat} frustumCulled={false} />
      <group ref={helixRef} visible={false}>
        <instancedMesh ref={beadsA} args={[resources.bead, resources.matA, PAIRS]} frustumCulled={false} />
        <instancedMesh ref={beadsB} args={[resources.bead, resources.matB, PAIRS]} frustumCulled={false} />
        <instancedMesh ref={rungs} args={[resources.rung, resources.matR, PAIRS]} frustumCulled={false} />
        <primitive object={resources.lineA} frustumCulled={false} />
        <primitive object={resources.lineB} frustumCulled={false} />
      </group>
    </group>
  );
}
