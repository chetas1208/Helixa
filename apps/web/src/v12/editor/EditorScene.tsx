import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ANATOMY_STAGE_AVAILABLE, AnatomyBody as BodyFigure, BodyPedestal } from "./anatomySlot";
import { useRenderPrefs } from "../shell/renderPrefs";
import { HelixModel } from "./HelixModel";
import type { FlashState, HelixApi } from "./HelixModel";
import { useEditorSceneStore } from "./editorSceneStore";
import { diffPositions, indexOfPosition } from "./editorModel";
import { BODY_WIDTH, HELIX_RADIUS, computeSceneLayout, helixHeight, indexToY, yawToFace } from "./helixGeometry";

/**
 * Genome Editor scene: the big holographic body figure (left column) + the DNA helix (right column) inside the
 * shell's single persistent <Canvas>. Both are always on screen; there is no view switching.
 * R3F isolation: reads ONLY `editorSceneStore` (plain data pushed by GenomeEditorTab).
 * Per-frame work: eased transforms/uniforms with delta; no setState, no allocations in the loop.
 *
 * Edit acknowledgement (draft change, same frame as the data): ring flash at the changed pair, a light packet
 * along the arc to the figure, then a scan sweep through the figure. The figure's shape never changes.
 */
const EMPTY: ReadonlySet<number> = new Set<number>();
const IDLE_SPIN = 0.09; // rad/s about the helix axis; pauses on interaction
const IDLE_RESUME_S = 4;
const SWAY = 0.12; // +-7 degrees
const PACKET_S = 0.3;
const MAX_PULSE_CHANGES = 12; // more than this at once is a reload, not an edit

/** Faint decorative arc between the figure and the helix, with a packet that runs helix -> figure on an edit. */
function LinkArc({ from, to, flashRef }: { from: THREE.Vector3; to: THREE.Vector3; flashRef: MutableRefObject<FlashState> }) {
  const { line, curve } = useMemo(() => {
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 2.6, -1));
    const c = new THREE.QuadraticBezierCurve3(from, mid, to);
    const pts = c.getPoints(64);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const colors = new Float32Array(pts.length * 3);
    pts.forEach((_p, i) => {
      const t = i / (pts.length - 1);
      const a = Math.sin(Math.PI * t) ** 1.5;
      colors[i * 3] = 0.35 * a; colors[i * 3 + 1] = 0.75 * a; colors[i * 3 + 2] = 1.0 * a;
    });
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45 });
    return { line: new THREE.Line(g, m), curve: c };
  }, [from, to]);
  const packetMat = useMemo(() => new THREE.SpriteMaterial({ color: "#d6f6ff", transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, map: dotTexture() }), []);
  const packet = useRef<THREE.Sprite>(null);
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  useEffect(() => () => packetMat.dispose(), [packetMat]);
  useFrame((state) => {
    const p = packet.current;
    if (!p) return;
    const t = (state.clock.elapsedTime - flashRef.current.at - 0.04) / PACKET_S;
    p.visible = t >= 0 && t <= 1;
    if (!p.visible) return;
    curve.getPoint(1 - t, p.position);
    p.scale.setScalar(0.9 + 0.5 * Math.sin(Math.PI * t));
    packetMat.opacity = 0.35 + 0.65 * Math.sin(Math.PI * t);
    (line.material as THREE.LineBasicMaterial).opacity = 0.45 + 0.5 * Math.sin(Math.PI * t);
  });
  return (
    <>
      <primitive object={line} />
      <sprite ref={packet} material={packetMat} renderOrder={12} visible={false} />
    </>
  );
}

let dotTex: THREE.CanvasTexture | null = null;
function dotTexture(): THREE.CanvasTexture {
  if (dotTex) return dotTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(170,235,255,0.8)");
    grad.addColorStop(1, "rgba(120,200,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

function HelixFloor({ y, radius }: { y: number; radius: number }) {
  const geo = useMemo(() => new THREE.CircleGeometry(radius, 64), [radius]);
  const ringGeo = useMemo(() => new THREE.RingGeometry(radius * 0.46, radius * 0.465, 128), [radius]);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uR: { value: radius } },
        vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ",
        fragmentShader: "uniform float uR; varying vec2 vP; void main(){ float r = length(vP)/uR; float a = pow(1.0-clamp(r,0.0,1.0), 2.4)*0.2; gl_FragColor = vec4(vec3(0.3,0.5,1.0)*a, a); }",
      }),
    [radius],
  );
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#69dcff", transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }), []);
  useEffect(() => () => { geo.dispose(); ringGeo.dispose(); mat.dispose(); ringMat.dispose(); }, [geo, ringGeo, mat, ringMat]);
  return (
    <group position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geo} material={mat} />
      <mesh geometry={ringGeo} material={ringMat} />
    </group>
  );
}

export function EditorScene() {
  const data = useEditorSceneStore();
  const { camera, size, gl, clock } = useThree();
  const qualityPref = useRenderPrefs((s) => s.qualityPref);
  const anatomyQuality = qualityPref === "low" || qualityPref === "high" ? qualityPref : "balanced";

  const n = data.baselineBases.length;
  const ready = data.status === "ready" && n > 0 && data.draftBases.length === n && data.savedBases.length === n;
  const split = ready && data.compareMode === "split" && data.originalBases.length === n;
  const overlay = ready && data.compareMode === "overlay" && data.originalBases.length === n;

  const draftChanged = useMemo(() => (ready ? new Set(diffPositions(data.savedBases, data.draftBases, data.start)) : EMPTY), [ready, data.savedBases, data.draftBases, data.start]);
  const savedChanged = useMemo(() => (ready ? new Set(diffPositions(data.baselineBases, data.savedBases, data.start)) : EMPTY), [ready, data.baselineBases, data.savedBases, data.start]);
  const originalSavedChanged = useMemo(() => (split ? new Set(diffPositions(data.baselineBases, data.originalBases, data.start)) : EMPTY), [split, data.baselineBases, data.originalBases, data.start]);

  // "was" letters: what a changed base read before. Default = previous version; overlay compare = the chosen original.
  const refLetters = useMemo(() => {
    if (!ready) return [] as (string | null)[];
    const out: (string | null)[] = [];
    for (let i = 0; i < n; i++) {
      const d = data.draftBases[i];
      let was: string | null = null;
      if (overlay) was = data.originalBases[i] !== d ? data.originalBases[i] : null;
      else if (d !== data.savedBases[i]) was = data.savedBases[i];
      else if (d !== data.baselineBases[i]) was = data.baselineBases[i];
      out.push(was);
    }
    return out;
  }, [ready, overlay, n, data.draftBases, data.savedBases, data.baselineBases, data.originalBases]);
  const noRef = useMemo(() => new Array<string | null>(n).fill(null), [n]);

  const selIndex = data.selectedPosition === null ? -1 : indexOfPosition(data.selectedPosition, data.start, n);
  const hasSelection = ready && selIndex >= 0;
  const focusIndex = ready ? (data.focusPosition !== null ? indexOfPosition(data.focusPosition, data.start, n) : -1) : -1;
  const focusIdxEff = focusIndex >= 0 ? focusIndex : hasSelection ? selIndex : (n - 1) / 2;

  const bodyRef = useRef<THREE.Group>(null);
  const bodyRoot = useRef<THREE.Group>(null);
  const helixRoot = useRef<THREE.Group>(null);
  const fadeBody = useRef<((v: number) => void) | null>(null);
  const fadePedestal = useRef<((v: number) => void) | null>(null);
  const spinRefs = useRef<(THREE.Group | null)[]>([null, null]);
  const spinA = (g: THREE.Group | null) => { spinRefs.current[0] = g; };
  const spinB = (g: THREE.Group | null) => { spinRefs.current[1] = g; };
  const focusY = useRef(0);
  const helixApi = useRef<HelixApi | null>(null);
  const flash = useRef<FlashState>({ at: -1e9, index: -1 });
  const bodyPulse = useRef(-1e9);

  const s = useRef({
    bodyYaw: 0, bodyYawTarget: 0, sway: 0,
    helixYaw: 0.5, helixYawTarget: null as number | null,
    camZ: 30, bodyX: -5, bodyY: 0, helixX: 4, helixY: 0, helixScale: 1, tilt: -0.06,
    helixShow: 0, bodyFade: 0,
    first: true, dragging: false, lastInteract: -100,
    focusTarget: 0,
  });
  const live = useRef({ ready });
  live.current.ready = ready;

  // Edit acknowledgement: fires on a draft-only change (saved bases and window unchanged), never on a reload.
  // Reduced motion skips this pulse only — drafts still apply (V14-ADR-009).
  const prev = useRef({ draft: "", saved: "", start: 0 });
  useEffect(() => {
    const p = prev.current;
    if (ready && !data.reducedMotion && p.start === data.start && p.saved === data.savedBases && p.draft.length === n && p.draft !== data.draftBases) {
      let first = -1;
      let count = 0;
      for (let i = 0; i < n; i++) if (p.draft[i] !== data.draftBases[i]) { if (first < 0) first = i; count++; }
      if (count > 0 && count <= MAX_PULSE_CHANGES) {
        const now = clock.elapsedTime;
        flash.current = { at: now, index: first };
        bodyPulse.current = now + PACKET_S;
      }
    }
    prev.current = { draft: ready ? data.draftBases : "", saved: ready ? data.savedBases : "", start: data.start };
  }, [ready, n, data.draftBases, data.savedBases, data.start, data.reducedMotion, clock]);

  useEffect(() => {
    const st = s.current;
    const want = data.bodyTurns * Math.PI;
    const k = Math.round((st.bodyYawTarget - want) / (Math.PI * 2));
    st.bodyYawTarget = want + k * Math.PI * 2;
  }, [data.bodyTurns]);

  useEffect(() => {
    const st = s.current;
    st.helixYawTarget = hasSelection ? yawToFace(selIndex, st.helixYaw) : null;
  }, [hasSelection, selIndex]);

  useEffect(() => { s.current.focusTarget = indexToY(focusIdxEff, Math.max(n, 1)); }, [focusIdxEff, n]);

  // Pointer: drag rotates the nearer subject; a click (no drag) picks the nearest base on the warped helix.
  useEffect(() => {
    const el = gl.domElement;
    const st = s.current;
    let startX = 0, startY = 0, lastX = 0, id = -1, moved = false;
    let target: "body" | "helix" | null = null;
    const v = new THREE.Vector3();
    const nearest = (clientX: number): "body" | "helix" => {
      const rect = el.getBoundingClientRect();
      const px = (x: number) => { v.set(x, 0, 0).project(camera); return rect.left + ((v.x + 1) / 2) * rect.width; };
      return Math.abs(clientX - px(st.bodyX)) < Math.abs(clientX - px(st.helixX)) ? "body" : "helix";
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      startX = lastX = e.clientX; startY = e.clientY; id = e.pointerId; moved = false;
      target = nearest(e.clientX);
    };
    const move = (e: PointerEvent) => {
      if (target === null || e.pointerId !== id) return;
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
      if (!moved) { moved = true; st.dragging = true; try { el.setPointerCapture(id); } catch { /* ignore */ } }
      const dx = e.clientX - lastX; lastX = e.clientX;
      st.lastInteract = performance.now() / 1000;
      if (target === "body") { st.bodyYawTarget += dx * 0.012; st.bodyYaw = st.bodyYawTarget; }
      else { st.helixYaw += dx * 0.012; if (st.helixYawTarget !== null) st.helixYawTarget = st.helixYaw; }
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const wasMoved = moved;
      const was = target;
      target = null; st.dragging = false;
      try { el.releasePointerCapture(id); } catch { /* none held */ }
      if (!wasMoved && was === "helix" && live.current.ready) {
        const pos = helixApi.current?.pick(camera, e.clientX, e.clientY, el.getBoundingClientRect());
        if (pos != null) { st.lastInteract = performance.now() / 1000; useEditorSceneStore.getState().onSelect(pos); }
      }
    };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
    };
  }, [gl, camera]);

  const cam = camera as THREE.PerspectiveCamera;
  const fov = cam.isPerspectiveCamera ? cam.fov : 45;
  const layout = useMemo(
    () => computeSceneLayout({ fovDeg: fov, split, helixBases: Math.max(n, 1), insets: data.insets, viewWidth: size.width, viewHeight: size.height }),
    [size.width, size.height, fov, split, n, data.insets],
  );

  useFrame((state, delta) => {
    const st = s.current;
    const dt = Math.min(delta, 0.05);
    const reduced = data.reducedMotion;
    const now = state.clock.elapsedTime;
    const k = (lambda: number) => (reduced || st.first ? 1 : 1 - Math.exp(-lambda * dt));

    // placement follows the layout quickly (resizes, inspector open/close, split compare)
    st.bodyX += (layout.bodyX - st.bodyX) * k(9);
    st.bodyY += (layout.bodyY - st.bodyY) * k(9);
    st.helixX += (layout.helixX - st.helixX) * k(9);
    st.helixY += (layout.helixY - st.helixY) * k(9);
    st.helixScale += (layout.helixScale - st.helixScale) * k(9);
    st.tilt += (layout.helixTilt - st.tilt) * k(6);
    st.camZ += (layout.camDistance - st.camZ) * k(9);
    st.bodyFade += (1 - st.bodyFade) * k(8);
    st.helixShow += ((ready ? 1 : 0) - st.helixShow) * k(10);

    const body = bodyRoot.current;
    if (body) {
      body.scale.setScalar(layout.bodyScale);
      body.position.set(st.bodyX, st.bodyY, 0);
    }
    fadeBody.current?.(st.bodyFade);
    fadePedestal.current?.(st.bodyFade);

    const hx = helixRoot.current;
    if (hx) {
      hx.visible = st.helixShow > 0.01;
      hx.scale.setScalar(Math.max(0.0001, st.helixShow) * st.helixScale);
      hx.position.set(st.helixX, st.helixY, 0);
      hx.rotation.z = st.tilt;
    }

    // body: eased toward the requested side, plus a slow sway that never fights a drag
    const bg = bodyRef.current;
    if (bg) {
      if (!st.dragging) st.bodyYaw += (st.bodyYawTarget - st.bodyYaw) * k(7);
      const idle = now - st.lastInteract > IDLE_RESUME_S;
      const swayTarget = reduced || st.dragging || !idle || data.paused ? 0 : Math.sin(now * 0.45) * SWAY;
      st.sway += (swayTarget - st.sway) * k(1.5);
      bg.rotation.y = st.bodyYaw + st.sway;
    }

    // helix: snap to face the selection, else slow idle rotation that pauses on interaction
    if (!st.dragging) {
      if (st.helixYawTarget !== null) st.helixYaw += (st.helixYawTarget - st.helixYaw) * k(10);
      else if (!reduced && !data.paused && now - st.lastInteract > IDLE_RESUME_S) st.helixYaw += IDLE_SPIN * dt;
    }
    for (const g of spinRefs.current) if (g) g.rotation.y = st.helixYaw;

    // focus window eases to its target (selection or scrubber)
    focusY.current += (st.focusTarget - focusY.current) * k(12);
    if (Math.abs(st.focusTarget - focusY.current) < 1e-4) focusY.current = st.focusTarget;

    // fixed camera: straight on, the layout already framed both subjects in the free area
    if (st.first) {
      st.bodyX = layout.bodyX; st.bodyY = layout.bodyY; st.helixX = layout.helixX; st.helixY = layout.helixY;
      st.helixScale = layout.helixScale; st.camZ = layout.camDistance; focusY.current = st.focusTarget; st.first = false;
    }
    cam.position.set(0, 0, st.camZ);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
  });

  const onFloorY = -(helixHeight(Math.max(n, 2)) / 2) - 1.1;
  const arcFrom = useMemo(
    () => new THREE.Vector3(layout.bodyX + (BODY_WIDTH / 2 - 0.5) * layout.bodyScale, layout.bodyY + 2.4 * layout.bodyScale, -0.5),
    [layout.bodyX, layout.bodyY, layout.bodyScale],
  );
  const arcTo = useMemo(
    () => new THREE.Vector3(layout.helixX - (HELIX_RADIUS + 0.9) * layout.helixScale, layout.helixY + 1.5 * layout.helixScale, -0.5),
    [layout.helixX, layout.helixY, layout.helixScale],
  );

  return (
    <group name="genome-editor-scene">
      <hemisphereLight args={["#bcd6ff", "#0b0f24", 0.7]} />
      <directionalLight position={[-5, 7, 9]} intensity={1.6} color="#d9ecff" />
      <directionalLight position={[7, 3, -7]} intensity={1.2} color="#8f6bff" />

      <group ref={bodyRoot}>
        {!ANATOMY_STAGE_AVAILABLE && <BodyPedestal fadeRef={fadePedestal} />}
        <BodyFigure
          ref={bodyRef}
          fadeRef={fadeBody as MutableRefObject<((v: number) => void) | null>}
          reducedMotion={data.reducedMotion}
          pulseRef={bodyPulse}
          quality={anatomyQuality}
          rect={{ x: 0, y: data.insets.top, width: size.width * (data.insets.leftFrac || 0.42), height: Math.max(0, size.height - data.insets.top - data.insets.bottomLeft) }}
        />
      </group>

      {ready && !split && <LinkArc from={arcFrom} to={arcTo} flashRef={flash} />}

      <group ref={helixRoot}>
        <HelixFloor y={onFloorY} radius={5.2} />
        {ready && !split && (
          <HelixModel ref={spinA} bases={data.draftBases} start={data.start} draftChanged={draftChanged} savedChanged={savedChanged} refLetters={refLetters} selectedPosition={data.selectedPosition} focusRef={focusY} apiRef={helixApi} flashRef={flash} />
        )}
        {split && (
          <>
            <group position={[-layout.splitGap, 0, 0]}>
              <HelixModel ref={spinA} bases={data.originalBases} start={data.start} draftChanged={EMPTY} savedChanged={originalSavedChanged} refLetters={noRef} selectedPosition={data.selectedPosition} focusRef={focusY} />
            </group>
            <group position={[layout.splitGap, 0, 0]}>
              <HelixModel ref={spinB} bases={data.draftBases} start={data.start} draftChanged={draftChanged} savedChanged={savedChanged} refLetters={refLetters} selectedPosition={data.selectedPosition} focusRef={focusY} apiRef={helixApi} flashRef={flash} />
            </group>
          </>
        )}
      </group>
    </group>
  );
}
