/**
 * Bridge between the DOM tab and the R3F EarthScene. React contexts (React Query, router) do not cross into
 * <Canvas>, so the DOM side pushes PLAIN data here and the scene reads it. `liveClock` is a mutable object the
 * playback controller writes every animation frame; the scene reads it inside useFrame (no setState per frame).
 */
import { create } from "zustand";

export interface SceneFrame {
  simulated_years: number;
  allele_frequency: number;
  population_size: number;
  extinct: boolean;
}

export const liveClock = { visibleYear: 0, playing: false };

interface EarthSceneState {
  /** Identifies the selected run whose frames are loaded (simulation_id). Null when there is no real run. */
  runKey: string | null;
  frames: SceneFrame[];
  horizonYears: number;
  popMax: number;
  /** Non-scientific lighting preview (0..1). Driven by draft context inputs; never touches model output. */
  preview: { warmth: number; wetness: number };
  reducedMotion: boolean;
  setRun: (runKey: string, frames: SceneFrame[], horizonYears: number) => void;
  clearRun: () => void;
  setPreview: (p: { warmth: number; wetness: number }) => void;
  setReducedMotion: (v: boolean) => void;
}

export const useEarthScene = create<EarthSceneState>((set) => ({
  runKey: null,
  frames: [],
  horizonYears: 0,
  popMax: 1,
  preview: { warmth: 0.5, wetness: 0.3 },
  reducedMotion: false,
  setRun: (runKey, frames, horizonYears) =>
    set({ runKey, frames, horizonYears, popMax: Math.max(1, ...frames.map((f) => f.population_size)) }),
  clearRun: () => set({ runKey: null, frames: [], horizonYears: 0, popMax: 1 }),
  setPreview: (preview) => set({ preview }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
}));
