import { useMemo } from "react";
import { create } from "zustand";
import { useSession } from "../state/session";

/**
 * Rendering / motion preferences + the health of the single persistent WebGL context.
 * Scenes inside <Canvas> may read this via `useRenderPrefs.getState()` (zustand needs no React context).
 * Only non-sensitive UI prefs are persisted (localStorage, guarded).
 */
export type QualityPref = "auto" | "low" | "balanced" | "high";
export type MotionPref = "system" | "reduce";
export type QualityTier = "low" | "balanced" | "high";
export type WebglStatus = "checking" | "ok" | "unsupported" | "lost" | "error";

export interface RenderSettings {
  tier: QualityTier;
  dpr: [number, number];
  /** null = display refresh rate. Low-power mode caps the loop. */
  fpsCap: number | null;
  lowPower: boolean;
  antialias: boolean;
}

export interface RenderEnv {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  devicePixelRatio?: number;
  saveData?: boolean;
}

const TIERS: Record<QualityTier, Omit<RenderSettings, "tier">> = {
  low: { dpr: [1, 1], fpsCap: 30, lowPower: true, antialias: false },
  balanced: { dpr: [1, 1.5], fpsCap: null, lowPower: false, antialias: true },
  high: { dpr: [1, 2], fpsCap: null, lowPower: false, antialias: true },
};

function detectTier(env: RenderEnv): QualityTier {
  const { hardwareConcurrency: cores, deviceMemory: memory, devicePixelRatio: ratio, saveData } = env;
  if (saveData) return "low";
  if (cores !== undefined && cores <= 4) return "low";
  if (memory !== undefined && memory <= 2) return "low";
  if (ratio !== undefined && ratio >= 3 && (cores === undefined || cores < 8)) return "low";
  return cores !== undefined && cores >= 8 && (memory === undefined || memory >= 8) ? "high" : "balanced";
}

/** Pure resolver (unit-testable). Explicit prefs always win over detection. */
export function resolveRenderSettings(pref: QualityPref, env: RenderEnv = {}): RenderSettings {
  const tier: QualityTier = pref === "auto" ? detectTier(env) : pref;
  const t = TIERS[tier];
  return { tier, dpr: [t.dpr[0], t.dpr[1]], fpsCap: t.fpsCap, lowPower: t.lowPower, antialias: t.antialias };
}

const STORAGE_KEY = "diamond.v12.renderPrefs";

function load(): { qualityPref: QualityPref; motionPref: MotionPref } {
  const fallback = { qualityPref: "auto" as QualityPref, motionPref: "system" as MotionPref };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<{ qualityPref: QualityPref; motionPref: MotionPref }>;
    return {
      qualityPref: p.qualityPref && ["auto", "low", "balanced", "high"].includes(p.qualityPref) ? p.qualityPref : "auto",
      motionPref: p.motionPref === "reduce" ? "reduce" : "system",
    };
  } catch {
    return fallback;
  }
}

function save(s: { qualityPref: QualityPref; motionPref: MotionPref }) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ qualityPref: s.qualityPref, motionPref: s.motionPref }));
  } catch {
    /* private mode / blocked storage: preference simply does not persist */
  }
}

interface RenderPrefsState {
  qualityPref: QualityPref;
  motionPref: MotionPref;
  setQualityPref: (q: QualityPref) => void;
  setMotionPref: (m: MotionPref) => void;

  webgl: WebglStatus;
  webglDetail: string | null;
  setWebgl: (s: WebglStatus, detail?: string | null) => void;
  /** Bumped to remount the <Canvas> after an unrecoverable failure (explicit user retry only). */
  canvasEpoch: number;
  retryWebgl: () => void;

  /** document.visibilityState === "hidden": the loop is paused while true. */
  hidden: boolean;
  setHidden: (h: boolean) => void;
}

export const useRenderPrefs = create<RenderPrefsState>((set, get) => ({
  ...load(),
  setQualityPref: (qualityPref) => {
    set({ qualityPref });
    save(get());
  },
  setMotionPref: (motionPref) => {
    set({ motionPref });
    save(get());
  },

  webgl: "checking",
  webglDetail: null,
  setWebgl: (webgl, webglDetail = null) => set({ webgl, webglDetail }),
  canvasEpoch: 0,
  retryWebgl: () => set((s) => ({ canvasEpoch: s.canvasEpoch + 1, webgl: "checking", webglDetail: null })),

  hidden: typeof document !== "undefined" ? document.visibilityState === "hidden" : false,
  setHidden: (hidden) => set({ hidden }),
}));

export function readRenderEnv(): RenderEnv {
  if (typeof navigator === "undefined") return {};
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    hardwareConcurrency: nav.hardwareConcurrency,
    deviceMemory: nav.deviceMemory,
    devicePixelRatio: typeof window === "undefined" ? undefined : window.devicePixelRatio,
    saveData: nav.connection?.saveData === true,
  };
}

/** Resolved settings for the current preference (referentially stable between changes). */
export function useRenderSettings(): RenderSettings {
  const pref = useRenderPrefs((s) => s.qualityPref);
  return useMemo(() => resolveRenderSettings(pref, readRenderEnv()), [pref]);
}

/** Effective reduced-motion: OS preference OR explicit user choice (mirrored into useSession.reducedMotion by App). */
export const useReducedMotion = () => useSession((s) => s.reducedMotion);
