import { createPortal, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { useAnatomySelection } from "../../v14/state/anatomySelection";
import { buildAtlasParts, buildParticleCloud, buildShellMerge } from "./atlasGeometry";
import { makeLabelTexture, makePointMaterial, makeShellMaterial } from "./atlasMaterials";
import { BODY_HOME, lerpPose, pointerToRectNdc, poseForBounds, type CameraPose } from "./cameraMath";
import { NODE_BY_ID, buildManifest, resolveFocusId } from "./catalog";
import { pickRankScore } from "./hitTable";
import { BODY_PULSE_S, qualityPreset } from "./quality";
import type { AnatomyQuality, AnatomyRect } from "./types";

export interface AnatomyStageProps {
  rect: AnatomyRect;
  quality: AnatomyQuality;
  reducedMotion: boolean;
  pulseRef?: MutableRefObject<number>;
}

const FOV = 32;
const MANIFEST = buildManifest();

function labelCopy(id: string | null): { title: string; note: string | null } | null {
  if (!id) return null;
  const n = NODE_BY_ID[id];
  if (!n) return { title: id, note: null };
  if (n.mesh_status === "unavailable") return { title: n.label, note: "3D mesh unavailable" };
  if (n.mesh_status === "approximate") return { title: n.label, note: "Approximate volume" };
  return { title: n.label, note: null };
}

function AtlasWorld({
  quality,
  reducedMotion,
  pulseRef,
  rootRef,
}: {
  quality: AnatomyQuality;
  reducedMotion: boolean;
  pulseRef?: MutableRefObject<number>;
  rootRef: MutableRefObject<THREE.Group | null>;
}) {
  const preset = qualityPreset(quality);
  const parts = useMemo(() => buildAtlasParts(quality), [quality]);
  const shell = useMemo(() => buildShellMerge(parts), [parts]);
  const cloud = useMemo(() => buildParticleCloud(shell, preset.particles), [shell, preset.particles]);
  const depthMat = useMemo(() => new THREE.MeshBasicMaterial({ colorWrite: false }), []);
  const pointMat = useMemo(() => makePointMaterial(), []);
  const mats = useMemo(() => parts.map((p) => makeShellMaterial(p.pickRank !== "region")), [parts]);
  const label = useRef<THREE.Sprite>(null);
  const labelMat = useRef<THREE.SpriteMaterial | null>(null);
  const labelTex = useRef<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false });
    labelMat.current = mat;
    const spr = label.current;
    if (spr) spr.material = mat;
    return () => { mat.dispose(); };
  }, []);

  useEffect(() => {
    const unsub = useAnatomySelection.subscribe((s) => {
      const copy = labelCopy(s.hoverId ?? s.anatomyId);
      const spr = label.current;
      const mat = labelMat.current;
      if (!spr || !mat) return;
      if (!copy) {
        spr.visible = false;
        return;
      }
      labelTex.current?.dispose();
      const tex = makeLabelTexture(copy.title, copy.note);
      labelTex.current = tex;
      mat.map = tex;
      mat.needsUpdate = true;
      const entry = Object.values(MANIFEST).find((e) => e.anatomy_id === (s.hoverId ?? s.anatomyId));
      const a = entry?.camera_anchor ?? [0, 2, 0.6];
      spr.position.set(a[0], a[1] + 0.55, a[2] + 0.35);
      spr.scale.set(2.4, 0.6, 1);
      spr.visible = true;
    });
    return () => {
      unsub();
      labelTex.current?.dispose();
    };
  }, []);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const pulse = pulseRef ? (now - pulseRef.current) / BODY_PULSE_S : -1;
    const pv = pulse >= 0 && pulse <= 1 ? pulse : -1;
    const { hoverId, anatomyId } = useAnatomySelection.getState();
    for (let i = 0; i < mats.length; i++) {
      const id = parts[i].anatomy_id;
      const lit = id === hoverId || id === anatomyId ? (id === anatomyId ? 1 : 0.55) : 0;
      const u = mats[i].uniforms;
      if (!reducedMotion) u.uTime.value = now;
      if (u.uPulse.value !== pv) u.uPulse.value = pv;
      if (u.uHighlight.value !== lit) u.uHighlight.value = lit;
    }
    if (pointMat.uniforms.uPulse.value !== pv) pointMat.uniforms.uPulse.value = pv;
    const g = rootRef.current;
    if (g && !reducedMotion) g.rotation.y = Math.sin(now * 0.22) * 0.08;
    else if (g && reducedMotion) g.rotation.y = 0;
  });

  useEffect(
    () => () => {
      parts.forEach((p) => p.geometry.dispose());
      shell?.dispose();
      cloud?.dispose();
      depthMat.dispose();
      pointMat.dispose();
      mats.forEach((m) => m.dispose());
    },
    [parts, shell, cloud, depthMat, pointMat, mats],
  );

  return (
    <group>
      <group ref={rootRef} name="anatomy-atlas-root">
        {shell && <mesh geometry={shell} material={depthMat} renderOrder={1} />}
        {parts.map((p, i) => (
          <mesh
            key={p.asset_id}
            geometry={p.geometry}
            material={mats[i]}
            userData={{ anatomy_id: p.anatomy_id, pickRank: p.pickRank, asset_id: p.asset_id }}
            renderOrder={p.pickRank === "region" ? 2 : 4}
          />
        ))}
        {cloud && <points geometry={cloud} material={pointMat} renderOrder={5} frustumCulled={false} />}
      </group>
      <sprite ref={label} renderOrder={20} visible={false} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[-2.4, 4.2, 6]} intensity={0.7} />
    </group>
  );
}

function ViewportBridge({
  scene,
  camera,
  rect,
  reducedMotion,
  pickRoot,
}: {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rect: AnatomyRect;
  reducedMotion: boolean;
  pickRoot: MutableRefObject<THREE.Group | null>;
}) {
  const { gl, size } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pose = useRef<{ cur: CameraPose; target: CameraPose; look: THREE.Vector3 }>({
    cur: { ...BODY_HOME },
    target: { ...BODY_HOME },
    look: new THREE.Vector3(...BODY_HOME.lookAt),
  });
  const lastNonce = useRef<number | null>(null);

  useEffect(() => {
    const unsub = useAnatomySelection.subscribe((s) => {
      if (!s.focusRequest || s.focusRequest.nonce === lastNonce.current) return;
      lastNonce.current = s.focusRequest.nonce;
      const raw = s.focusRequest.anatomyId;
      if (!raw) {
        pose.current.target = { ...BODY_HOME };
        return;
      }
      const focusId = resolveFocusId(raw);
      const entry = focusId ? Object.values(MANIFEST).find((e) => e.anatomy_id === focusId) : undefined;
      pose.current.target = entry ? poseForBounds(entry.bounds, FOV, entry.camera_anchor) : { ...BODY_HOME };
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const el = gl.domElement;
    const pickAt = (clientX: number, clientY: number): string | null => {
      const box = el.getBoundingClientRect();
      const cssX = clientX - box.left;
      const cssY = clientY - box.top;
      const ndc = pointerToRectNdc(cssX, cssY, rect);
      if (!ndc) return null;
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
      raycaster.setFromCamera(new THREE.Vector2(ndc[0], ndc[1]), camera);
      const objs = pickRoot.current?.children.filter((c) => c.userData?.anatomy_id) ?? [];
      const hits = raycaster.intersectObjects(objs, false);
      if (hits.length === 0) return null;
      hits.sort((a, b) => {
        const ra = pickRankScore(a.object.userData.pickRank);
        const rb = pickRankScore(b.object.userData.pickRank);
        if (ra !== rb) return rb - ra;
        return a.distance - b.distance;
      });
      return (hits[0].object.userData.anatomy_id as string) ?? null;
    };

    let downX = 0, downY = 0, dragging = false, inside = false;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const box = el.getBoundingClientRect();
      inside = pointerToRectNdc(e.clientX - box.left, e.clientY - box.top, rect) !== null;
      if (!inside) return;
      downX = e.clientX; downY = e.clientY; dragging = false;
    };
    const move = (e: PointerEvent) => {
      const id = pickAt(e.clientX, e.clientY);
      useAnatomySelection.getState().hover(id);
      if (!inside) return;
      if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 7) dragging = true;
    };
    const up = (e: PointerEvent) => {
      if (!inside) return;
      inside = false;
      if (dragging) return;
      const id = pickAt(e.clientX, e.clientY);
      if (id) useAnatomySelection.getState().selectAnatomy(id, { focus: true });
    };
    const leave = () => useAnatomySelection.getState().hover(null);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", leave);
    };
  }, [gl, camera, rect, raycaster, pickRoot]);

  useFrame((_state, delta) => {
    if (rect.width < 8 || rect.height < 8) return;
    const dpr = gl.getPixelRatio();
    camera.fov = FOV;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    const st = pose.current;
    const t = reducedMotion ? 1 : 1 - Math.exp(-4.2 * Math.min(delta, 0.05));
    st.cur = lerpPose(st.cur, st.target, t);
    camera.position.set(...st.cur.position);
    st.look.set(...st.cur.lookAt);
    camera.lookAt(st.look);
    camera.updateMatrixWorld();

    const x = rect.x * dpr;
    const y = (size.height - rect.y - rect.height) * dpr;
    const w = rect.width * dpr;
    const h = rect.height * dpr;
    const prev = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.setScissorTest(true);
    gl.setViewport(x, y, w, h);
    gl.setScissor(x, y, w, h);
    gl.render(scene, camera);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width * dpr, size.height * dpr);
    gl.autoClear = prev;
  }, 1);

  return null;
}

export function AnatomyStage({ rect, quality, reducedMotion, pulseRef }: AnatomyStageProps) {
  const scene = useMemo(() => new THREE.Scene(), []);
  const camera = useMemo(() => new THREE.PerspectiveCamera(FOV, 1, 0.12, 80), []);
  const rootRef = useRef<THREE.Group | null>(null);

  return (
    <group name="anatomy-stage" userData={{ testid: "anatomy-stage" }}>
      {createPortal(
        <AtlasWorld quality={quality} reducedMotion={reducedMotion} pulseRef={pulseRef} rootRef={rootRef} />,
        scene,
      )}
      <ViewportBridge scene={scene} camera={camera} rect={rect} reducedMotion={reducedMotion} pickRoot={rootRef} />
    </group>
  );
}
