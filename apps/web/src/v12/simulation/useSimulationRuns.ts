import { useCallback } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiGetParsed } from "../api/client";
import { qk, useRunSimulation } from "../api/hooks";
import { SimulationSchema } from "../api/schemas";
import type { Simulation } from "../types";
import { idempotencyKey, replicateSeeds, toRequest } from "./scenario";
import { useSimulationStore } from "./simulationStore";

export interface RunEntry {
  id: string;
  sim: Simulation | undefined;
  loading: boolean;
  error: string | null;
}

/** Fetch remembered/selected runs by id (the backend has no list endpoint). Results are immutable, so cached forever. */
export function useRunsData(ids: string[], workspaceId: string | null): RunEntry[] {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: qk.simulation(id, workspaceId ?? undefined),
      queryFn: async ({ signal }: { signal?: AbortSignal }) => {
        const sim = await apiGetParsed(`/api/v10/evolution/simulations/${encodeURIComponent(id)}`, SimulationSchema, signal);
        if (workspaceId && sim.workspace_id !== workspaceId) throw new ApiError(502, `Run ${id} belongs to workspace ${sim.workspace_id}, not the active one.`, "/api/v10/evolution/simulations");
        return sim as Simulation;
      },
      staleTime: Infinity,
      retry: false,
    })),
  });
  return ids.map((id, i) => ({
    id,
    sim: results[i]?.data,
    loading: !!results[i]?.isLoading,
    error: results[i]?.error ? (results[i].error as Error).message : null,
  }));
}

/**
 * Client-orchestrated run: N requests with distinct seeds, one at a time. The request is synchronous on the
 * server; there is no progress or ETA, only "run i of N". The completed runs are real backend results.
 */
export function useSimulationRunner(workspaceId: string | null, revisionId: string | null) {
  const mutation = useRunSimulation();
  const qc = useQueryClient();
  const run = useCallback(async () => {
    if (!workspaceId || !revisionId) return;
    const store = useSimulationStore.getState();
    const draft = (store.byWs[workspaceId] ?? { draft: null }).draft;
    if (!draft) return;
    const seeds = replicateSeeds(draft.seed, draft.replicates);
    store.patch(workspaceId, { lifecycle: "pending", error: null, progress: { done: 0, total: seeds.length } });
    try {
      for (let i = 0; i < seeds.length; i++) {
        const sim = await mutation.mutateAsync({
          request: toRequest(draft, workspaceId, seeds[i]),
          idempotencyKey: idempotencyKey(draft, workspaceId, revisionId, seeds[i]),
        });
        if (sim.workspace_id !== workspaceId) throw new ApiError(200, `Backend returned a run for workspace ${sim.workspace_id}; refusing to show it.`, "/api/v10/evolution/simulations");
        qc.setQueryData(qk.simulation(sim.simulation_id, workspaceId), sim); // the data layer also remembers the id
        useSimulationStore.getState().addRun(workspaceId, sim.simulation_id, i === 0);
        useSimulationStore.getState().patch(workspaceId, { progress: { done: i + 1, total: seeds.length } });
      }
      useSimulationStore.getState().patch(workspaceId, { lifecycle: "complete" });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, (e as Error).message, "");
      useSimulationStore.getState().patch(workspaceId, {
        lifecycle: "failed",
        error: { status: err.status, detail: err.detail, unreachable: err.status === 0 },
      });
    }
  }, [workspaceId, revisionId, mutation, qc]);
  return { run, pending: mutation.isPending };
}
