/**
 * Simulation UI state, per workspace, kept in zustand so the scenario DRAFT and run selection survive tab
 * switches. Results themselves live in the React Query cache (qk.simulation(id)); this store only holds ids.
 * The draft is never merged into results: changing a parameter cannot alter or delete a completed run.
 */
import { create } from "zustand";
import { defaultScenario } from "./scenario";
import type { ScenarioDraft } from "./scenario";

export type Lifecycle = "idle" | "pending" | "complete" | "failed";

export interface RunError {
  status: number;
  detail: string;
  unreachable: boolean;
}

export interface WsSim {
  draft: ScenarioDraft;
  lifecycle: Lifecycle;
  error: RunError | null;
  progress: { done: number; total: number } | null;
  runIds: string[];
  selectedRunId: string | null;
  compareRunId: string | null;
  hydrated: boolean;
}

const fresh = (): WsSim => ({ draft: defaultScenario(), lifecycle: "idle", error: null, progress: null, runIds: [], selectedRunId: null, compareRunId: null, hydrated: false });
export const EMPTY_WS_SIM: WsSim = fresh();

interface SimulationStore {
  byWs: Record<string, WsSim>;
  patch: (ws: string, p: Partial<WsSim>) => void;
  patchDraft: (ws: string, p: Partial<ScenarioDraft>) => void;
  resetDraft: (ws: string) => void;
  addRun: (ws: string, id: string, select?: boolean) => void;
}

const get = (s: Record<string, WsSim>, ws: string) => s[ws] ?? fresh();

export const useSimulationStore = create<SimulationStore>((set) => ({
  byWs: {},
  patch: (ws, p) => set((s) => ({ byWs: { ...s.byWs, [ws]: { ...get(s.byWs, ws), ...p } } })),
  patchDraft: (ws, p) => set((s) => ({ byWs: { ...s.byWs, [ws]: { ...get(s.byWs, ws), draft: { ...get(s.byWs, ws).draft, ...p } } } })),
  resetDraft: (ws) => set((s) => ({ byWs: { ...s.byWs, [ws]: { ...get(s.byWs, ws), draft: defaultScenario() } } })),
  addRun: (ws, id, select = true) =>
    set((s) => {
      const cur = get(s.byWs, ws);
      const runIds = cur.runIds.includes(id) ? cur.runIds : [...cur.runIds, id].slice(-12);
      return { byWs: { ...s.byWs, [ws]: { ...cur, runIds, selectedRunId: select ? id : cur.selectedRunId } } };
    }),
}));

export const useWsSim = (ws: string | null): WsSim => useSimulationStore((s) => (ws ? s.byWs[ws] ?? EMPTY_WS_SIM : EMPTY_WS_SIM));
