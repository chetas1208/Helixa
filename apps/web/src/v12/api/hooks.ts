/**
 * Typed data hooks. Contract owner: Agent D. Signatures are the frozen contract; this module only
 * hardens implementations (zod validation of every response, AbortSignal via react-query, workspace-id
 * scoped keys, display guards) and adds hooks. No response reaches a component without passing
 * its schema in ./schemas.ts.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, CONTRACT_MISMATCH_DETAIL, apiGetParsed, apiPatchParsed, apiPost, apiPostParsed, isApiError } from "./client";
import { PROBE_WORKSPACE_ID, routeExists } from "./capabilities";
import type { ProbeKind, ProbeOutcome } from "./capabilities";
import { qk } from "./queryKeys";
import { connectionFromHealth, healthRefetchInterval } from "./connection";
import {
  EnvironmentCatalogSchema,
  FixtureCatalogSchema,
  GenomeWindowSchema,
  HarnessLineageSchema,
  HarnessListSchema,
  HealthResponseSchema,
  IntelligenceSchema,
  ParameterCatalogSchema,
  ProposalSchema,
  ReferenceInfoSchema,
  SimulationListSchema,
  SimulationSchema,
  WorkspaceListSchema,
  WorkspaceSchema,
} from "./schemas";
import type { LineageResult, TranscriptionAvailability, WorkspaceCapabilities } from "./schemas";
import { recallSimulations, rememberSimulation, subscribeSimulationMemory, simulationMemoryVersion } from "./simMemory";
import { useSession } from "../state/session";
import type { SimulationRequest } from "../types";

export { qk } from "./queryKeys";
export { recallSimulations, rememberSimulation } from "./simMemory";
export type { LineageResult, TranscriptionAvailability, HarnessLineage, HealthResponse, WorkspaceCapabilities } from "./schemas";

const V10 = "/api/v10";
const enc = encodeURIComponent;

/** A well-formed body about the wrong workspace is a contract failure, never render state. */
function assertSameWorkspace(path: string, expected: string, actual: string): void {
  if (expected !== actual) throw new ApiError(502, CONTRACT_MISMATCH_DETAIL, path, [`workspace_id: expected ${expected}`]);
}

// ---------- reads ----------

export const useReference = () =>
  useQuery({ queryKey: qk.reference, queryFn: ({ signal }) => apiGetParsed(`${V10}/genome/baselines`, ReferenceInfoSchema, signal), staleTime: Infinity });

export const useGenomeWindow = (start: number, end: number) =>
  useQuery({
    queryKey: qk.window(start, end),
    queryFn: ({ signal }) => apiGetParsed(`${V10}/genome/window?start=${start}&end=${end}`, GenomeWindowSchema, signal),
    staleTime: Infinity,
  });

export const useWorkspaces = () =>
  useQuery({ queryKey: qk.workspaces, queryFn: ({ signal }) => apiGetParsed(`${V10}/genome/workspaces`, WorkspaceListSchema, signal), staleTime: 5_000 });

export const useWorkspace = (id: string | null) =>
  useQuery({
    queryKey: qk.workspace(id ?? "none"),
    enabled: !!id,
    staleTime: 5_000,
    queryFn: async ({ signal }) => {
      const path = `${V10}/genome/workspaces/${enc(id ?? "")}`;
      const ws = await apiGetParsed(path, WorkspaceSchema, signal);
      assertSameWorkspace(path, id ?? "", ws.workspace_id);
      return ws;
    },
  });

export const useIntelligence = (id: string | null, revisionId?: string) =>
  useQuery({
    queryKey: qk.intelligence(id ?? "none", revisionId),
    enabled: !!id,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      const path = `${V10}/genome/workspaces/${enc(id ?? "")}/intelligence`;
      const out = await apiGetParsed(path, IntelligenceSchema, signal);
      assertSameWorkspace(path, id ?? "", out.workspace_id);
      return out;
    },
  });

export const useParameterSpecs = () =>
  useQuery({ queryKey: qk.parameters, queryFn: ({ signal }) => apiGetParsed(`${V10}/evolution/parameters`, ParameterCatalogSchema, signal), staleTime: Infinity });

export const useEnvironmentPresets = () =>
  useQuery({ queryKey: qk.environments, queryFn: ({ signal }) => apiGetParsed(`${V10}/evolution/environments`, EnvironmentCatalogSchema, signal), staleTime: Infinity });

/**
 * Simulations are immutable once created. Pass `workspaceId` (optional, backward compatible) to
 * scope the cache entry and to reject a result that belongs to a different workspace.
 */
export const useSimulation = (id: string | null, workspaceId?: string | null) =>
  useQuery({
    queryKey: qk.simulation(id ?? "none", workspaceId ?? undefined),
    enabled: !!id,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const path = `${V10}/evolution/simulations/${enc(id ?? "")}`;
      const sim = await apiGetParsed(path, SimulationSchema, signal);
      if (workspaceId) assertSameWorkspace(path, workspaceId, sim.workspace_id);
      return sim;
    },
  });

export const useFixtures = () =>
  useQuery({ queryKey: qk.fixtures, queryFn: ({ signal }) => apiGetParsed("/api/fixtures", FixtureCatalogSchema, signal), staleTime: Infinity });

// ---------- legacy harness registry (analysis harness versions, not biology) ----------

export const useHarnesses = () =>
  useQuery({ queryKey: qk.harnesses, queryFn: ({ signal }) => apiGetParsed("/api/harnesses", HarnessListSchema, signal), staleTime: 30_000 });

/** 404 is a normal state: "no lineage recorded". Other errors still raise. */
export const useHarnessLineage = (id: string | null) =>
  useQuery<LineageResult>({
    queryKey: qk.harnessLineage(id ?? "none"),
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      try {
        const lineage = await apiGetParsed(`/api/harnesses/${enc(id ?? "")}/lineage`, HarnessLineageSchema, signal);
        return { recorded: true, lineage };
      } catch (e) {
        if (isApiError(e) && e.notFound) return { recorded: false, reason: "No lineage recorded for this harness version." };
        throw e;
      }
    },
  });

// ---------- connection + capability probes ----------

/** Polls /api/health and mirrors the result into session.connection (real API health, never a toggle). */
export function useHealth() {
  const setConnection = useSession((s) => s.setConnection);
  const connection = useSession((s) => s.connection);
  const q = useQuery({
    queryKey: qk.health,
    queryFn: ({ signal }) => apiGetParsed("/api/health", HealthResponseSchema, signal),
    retry: false,
    staleTime: 0,
    gcTime: 60_000,
    refetchInterval: healthRefetchInterval(connection),
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (q.status === "pending") return;
    setConnection(connectionFromHealth(q.status === "error" ? { error: q.error } : { data: q.data }));
  }, [q.status, q.data, q.error, q.dataUpdatedAt, q.errorUpdatedAt, setConnection]);
  return q;
}

/**
 * Is server-side speech-to-text present? Probes `POST /api/voice/transcribe` with an empty JSON body (no audio):
 * a conforming endpoint rejects it with 4xx validation (=> present), an absent route answers 404/405/501.
 * Today the route does not exist, so this resolves to { available: false }.
 */
export const useTranscriptionAvailability = () =>
  useQuery<TranscriptionAvailability>({
    queryKey: qk.transcription,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        await apiPost<unknown>("/api/voice/transcribe", {}, { signal, headers: { "X-Capability-Probe": "1" } });
        return { available: true, reason: "Transcription endpoint responded." };
      } catch (e) {
        if (!isApiError(e)) throw e;
        if (e.status === 0) return { available: false, reason: "API unreachable, transcription status unknown." };
        if (e.status === 404 || e.status === 405 || e.status === 501) {
          return { available: false, reason: "Voice transcription is not configured: the API has no /api/voice/transcribe endpoint." };
        }
        if (e.status === 400 || e.status === 415 || e.status === 422) return { available: true, reason: "Transcription endpoint present (it rejected an empty probe, as expected)." };
        if (e.status === 401 || e.status === 403) return { available: false, reason: "Transcription endpoint requires authorisation." };
        return { available: false, reason: `Transcription endpoint unavailable (HTTP ${e.status}).` };
      }
    },
  });

// ---------- optional workspace routes (rename / archive / list simulations) ----------

async function probe(kind: ProbeKind, signal: AbortSignal): Promise<boolean> {
  const id = PROBE_WORKSPACE_ID;
  const outcome: ProbeOutcome = await (async () => {
    try {
      if (kind === "rename") await apiPatchParsed(`${V10}/genome/workspaces/${id}`, { name: "probe" }, WorkspaceSchema, { signal });
      else if (kind === "archive") await apiPostParsed(`${V10}/genome/workspaces/${id}/archive`, {}, WorkspaceSchema, { signal });
      else await apiGetParsed(`${V10}/evolution/simulations?workspace_id=${id}`, SimulationListSchema, signal);
      return { status: 200, detail: "" };
    } catch (e) {
      if (isApiError(e)) return { status: e.contractMismatch ? 200 : e.status, detail: e.detail };
      throw e;
    }
  })();
  return routeExists(kind, outcome);
}

/** Which optional routes exist on THIS backend. Rename/Archive/server-side run listing are enabled only when true. */
export const useWorkspaceCapabilities = () =>
  useQuery<WorkspaceCapabilities>({
    queryKey: qk.capabilities,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const [rename, archive, listSimulations] = await Promise.all([probe("rename", signal), probe("archive", signal), probe("listSimulations", signal)]);
      return { rename, archive, listSimulations };
    },
  });

/** Server-side run list for a workspace (oldest first as returned). Only fetched when the route exists. */
export function useListedSimulations(workspaceId: string | null, enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.workspaceSimulations(workspaceId ?? "none"),
    enabled: !!workspaceId && enabled,
    staleTime: 15_000,
    queryFn: async ({ signal }) => {
      const id = workspaceId ?? "";
      const path = `${V10}/evolution/simulations?workspace_id=${enc(id)}`;
      const out = await apiGetParsed(path, SimulationListSchema, signal);
      for (const sim of out.simulations) {
        assertSameWorkspace(path, id, sim.workspace_id);
        qc.setQueryData(qk.simulation(sim.simulation_id, id), sim); // rows render without a second fetch
      }
      return out.simulations;
    },
  });
}

// ---------- remembered simulation ids ----------

/** Re-renders when ids are remembered in this session. Returns newest first. */
export function useRememberedSimulations(workspaceId: string | null): string[] {
  const v = useSyncExternalStore(subscribeSimulationMemory, simulationMemoryVersion, simulationMemoryVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (workspaceId ? recallSimulations(workspaceId) : []), [workspaceId, v]);
}

// ---------- mutations ----------

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiPostParsed(`${V10}/genome/workspaces`, { name }, WorkspaceSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export function useBranchWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; name: string }) =>
      apiPostParsed(`${V10}/genome/workspaces/${enc(v.workspaceId)}/branch`, { name: v.name }, WorkspaceSchema),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export function useSelectWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { workspaceId: string; expectedCounter?: number | null; signal?: AbortSignal }) =>
      apiPostParsed(`${V10}/genome/workspaces/${enc(v.workspaceId)}/select`, { expected_counter: v.expectedCounter ?? null }, WorkspaceSchema, { signal: v.signal }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.workspaces }),
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { workspaceId: string; name: string }) => {
      const path = `${V10}/genome/workspaces/${enc(v.workspaceId)}`;
      const ws = await apiPatchParsed(path, { name: v.name }, WorkspaceSchema);
      assertSameWorkspace(path, v.workspaceId, ws.workspace_id);
      return ws;
    },
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      qc.invalidateQueries({ queryKey: qk.workspace(ws.workspace_id) });
    },
  });
}

export function useArchiveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { workspaceId: string }) => {
      const path = `${V10}/genome/workspaces/${enc(v.workspaceId)}/archive`;
      const ws = await apiPostParsed(path, {}, WorkspaceSchema);
      assertSameWorkspace(path, v.workspaceId, ws.workspace_id);
      return ws;
    },
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      qc.invalidateQueries({ queryKey: qk.workspace(ws.workspace_id) });
    },
  });
}

export const useProposeEdit = () =>
  useMutation({
    mutationFn: async (v: { workspaceId: string; position: number; alt: string; note?: string }) => {
      const path = `${V10}/genome/workspaces/${enc(v.workspaceId)}/proposals`;
      const p = await apiPostParsed(path, { position: v.position, alt: v.alt, note: v.note ?? "" }, ProposalSchema);
      assertSameWorkspace(path, v.workspaceId, p.workspace_id);
      return p;
    },
  });

export function useCommitEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { workspaceId: string; proposalId: string; expectedCounter: number }) => {
      const path = `${V10}/genome/workspaces/${enc(v.workspaceId)}/commit`;
      const ws = await apiPostParsed(path, { proposal_id: v.proposalId, expected_counter: v.expectedCounter }, WorkspaceSchema);
      assertSameWorkspace(path, v.workspaceId, ws.workspace_id);
      return ws;
    },
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: qk.workspaces });
      qc.invalidateQueries({ queryKey: qk.workspace(ws.workspace_id) });
      qc.invalidateQueries({ queryKey: ["intelligence", ws.workspace_id] });
    },
  });
}

/** Runs a simulation; the new id is remembered for its workspace automatically (ids only). */
export function useRunSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { request: SimulationRequest; idempotencyKey?: string }) =>
      apiPostParsed(`${V10}/evolution/simulations`, v.request, SimulationSchema, v.idempotencyKey ? { headers: { "Idempotency-Key": v.idempotencyKey } } : undefined),
    onSuccess: (sim) => {
      rememberSimulation(sim.workspace_id, sim.simulation_id);
      qc.setQueryData(qk.simulation(sim.simulation_id, sim.workspace_id), sim);
      qc.setQueryData(qk.simulation(sim.simulation_id), sim);
    },
  });
}
