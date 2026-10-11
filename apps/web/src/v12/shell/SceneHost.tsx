import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useSession } from "../state/session";
import type { TabId } from "../types";
import { AmbientBackdrop } from "./AmbientBackdrop";
import { useRenderPrefs, useRenderSettings } from "./renderPrefs";
import { WebGLFallback } from "./WebGLFallback";

/**
 * The ONE persistent WebGL context (z-0, fixed, full-bleed).
 *  - Active tab picks the scene: editor -> EditorScene, simulation -> EarthScene; evolution and
 *    library show only the subdued ambient backdrop (the helix is never their hero).
 *  - The <Canvas> is never remounted on tab switch. Scenes (lazy) mount/unmount inside it and dispose themselves.
 *  - Pauses (frameloop "never") when the document is hidden; low-power mode drives a 30 fps cap.
 *  - Context loss / no WebGL / scene crash -> CSS/SVG fallback; the DOM tabs keep working.
 * Pointer events are NOT blocked here: the HUD stage is click-through, so drags reach OrbitControls.
 */

const EditorScene = lazy(() => import("../editor/EditorScene").then((m) => ({ default: m.EditorScene })));
const EarthScene = lazy(() => import("../simulation/EarthScene").then((m) => ({ default: m.EarthScene })));

const DEFAULT_CAMERA = { position: [0, 0, 18] as [number, number, number], fov: 45, near: 0.1, far: 200 };

export function detectWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    const gl = (probe.getContext("webgl2") || probe.getContext("webgl") || probe.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

class SceneBoundary extends Component<{ name: string; onError: (msg: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[SceneHost] ${this.props.name} crashed`, error, info.componentStack);
    this.props.onError(`${this.props.name}: ${error.message}`);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Listens for WebGL context loss / restore on the single renderer. */
function ContextGuard() {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      e.preventDefault();
      useRenderPrefs.getState().setWebgl("lost", "The browser reclaimed the graphics context.");
    };
    const restored = () => {
      useRenderPrefs.getState().setWebgl("ok");
      invalidate();
    };
    el.addEventListener("webglcontextlost", lost);
    el.addEventListener("webglcontextrestored", restored);
    return () => {
      el.removeEventListener("webglcontextlost", lost);
      el.removeEventListener("webglcontextrestored", restored);
    };
  }, [gl, invalidate]);
  return null;
}

/** Low-power mode: R3F loop is "never"; advance it at fpsCap. Never calls setState. */
function FrameLimiter({ fps }: { fps: number }) {
  const advance = useThree((s) => s.advance);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const step = 1000 / fps;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - last < step - 1) return;
      last = now;
      advance(now / 1000);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [advance, fps]);
  return null;
}

const HOME = new THREE.Vector3(...DEFAULT_CAMERA.position);

/**
 * On tabs without their own scene the camera eases back to the default pose so the ambient
 * backdrop is composed consistently. Scenes set their own pose when they mount.
 */
function CameraDirector() {
  const settled = useRef(false);
  const lastTab = useRef<TabId | null>(null);
  useFrame((state, delta) => {
    const { activeTab, reducedMotion } = useSession.getState();
    if (lastTab.current !== activeTab) {
      lastTab.current = activeTab;
      settled.current = false;
    }
    if (activeTab === "editor" || activeTab === "simulation" || settled.current) return;
    const cam = state.camera as THREE.PerspectiveCamera;
    cam.up.set(0, 1, 0);
    if (cam.fov !== DEFAULT_CAMERA.fov) {
      cam.fov = DEFAULT_CAMERA.fov;
      cam.zoom = 1;
      cam.updateProjectionMatrix();
    }
    if (reducedMotion) {
      cam.position.copy(HOME);
      cam.quaternion.identity();
      settled.current = true;
      return;
    }
    const k = 1 - Math.exp(-3 * Math.min(delta, 0.05));
    cam.position.lerp(HOME, k);
    cam.quaternion.slerp(new THREE.Quaternion(), k);
    if (cam.position.distanceToSquared(HOME) < 1e-5) {
      cam.position.copy(HOME);
      cam.quaternion.identity();
      settled.current = true;
    }
  });
  return null;
}

function Scenes({ onSceneError }: { onSceneError: (m: string) => void }) {
  const tab = useSession((s) => s.activeTab);
  return (
    <>
      <CameraDirector />
      <AmbientBackdrop />
      <Suspense fallback={null}>
        {tab === "editor" && (
          <SceneBoundary key="editor" name="Genome Editor scene" onError={onSceneError}>
            <EditorScene />
          </SceneBoundary>
        )}
        {tab === "simulation" && (
          <SceneBoundary key="simulation" name="Earth Evolution Sandbox scene" onError={onSceneError}>
            <EarthScene />
          </SceneBoundary>
        )}
      </Suspense>
    </>
  );
}

export function SceneHost() {
  const settings = useRenderSettings();
  const webgl = useRenderPrefs((s) => s.webgl);
  const epoch = useRenderPrefs((s) => s.canvasEpoch);
  const hidden = useRenderPrefs((s) => s.hidden);
  const tab = useSession((s) => s.activeTab);
  const [supported] = useState(detectWebGL);
  // Antialias is fixed when the context is created; later quality changes adjust dpr / fps only.
  const [initialAA, setInitialAA] = useState(settings.antialias);

  useEffect(() => {
    const { setWebgl, setHidden } = useRenderPrefs.getState();
    if (!supported) setWebgl("unsupported", "WebGL is not available in this browser.");
    else setWebgl("ok");
    const onVis = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    onVis();
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [supported, epoch]);

  // A user-driven retry re-reads the antialias decision for the fresh context.
  useEffect(() => {
    if (epoch > 0) setInitialAA(settings.antialias);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  // "error" = a scene crashed: the canvas (ambient) stays. "unsupported" = no/failed context: 2D fallback only.
  const showCanvas = supported && webgl !== "unsupported";
  const showFallback = !showCanvas || webgl === "lost";
  const limited = settings.fpsCap !== null;
  const frameloop = hidden || limited ? "never" : "always";

  return (
    <div className="scene-host" data-testid="scene-host" data-webgl={webgl} data-tab={tab} aria-hidden="true">
      <div className="scene-atmosphere" />
      {showCanvas && (
        <SceneBoundary key={epoch} name="3D renderer" onError={(m) => useRenderPrefs.getState().setWebgl("unsupported", m)}>
        <Canvas
          camera={DEFAULT_CAMERA}
          dpr={settings.dpr}
          frameloop={frameloop}
          gl={{ antialias: initialAA, alpha: true, powerPreference: settings.lowPower ? "default" : "high-performance", stencil: false }}
          style={{ position: "absolute", inset: 0 }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <ContextGuard />
          {limited && !hidden && <FrameLimiter fps={settings.fpsCap as number} />}
          <Scenes onSceneError={(m) => useRenderPrefs.getState().setWebgl("error", m)} />
        </Canvas>
        </SceneBoundary>
      )}
      {showFallback && <WebGLFallback subdued={tab === "library" || tab === "evolution"} />}
    </div>
  );
}
