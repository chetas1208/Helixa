import type { QueryClient } from "@tanstack/react-query";
import { apiGetParsed } from "../api/client";
import { recallSimulations } from "../api/simMemory";
import { qk } from "../api/queryKeys";
import { SimulationListSchema, SimulationSchema } from "../api/schemas";
import type { Workspace } from "../types";
import { buildProvenanceExport, mergeRunIds, provenanceFilename, simulationRef } from "./libraryModel";
import type { ProvenanceSimulationRef } from "./libraryModel";

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Collects this workspace's runs (server list when the route exists + remembered ids) and downloads the provenance JSON. */
export async function exportWorkspaceProvenance(qc: QueryClient, ws: Workspace, all: readonly Workspace[], serverListing: boolean): Promise<void> {
  let serverIds: string[] = [];
  if (serverListing) {
    try {
      const list = await qc.fetchQuery({
        queryKey: qk.workspaceSimulations(ws.workspace_id),
        staleTime: 15_000,
        queryFn: ({ signal }) => apiGetParsed(`/api/v10/evolution/simulations?workspace_id=${encodeURIComponent(ws.workspace_id)}`, SimulationListSchema, signal).then((o) => o.simulations),
      });
      serverIds = list.filter((s) => s.workspace_id === ws.workspace_id).map((s) => s.simulation_id);
    } catch {
      /* fall back to remembered ids */
    }
  }
  const ids = mergeRunIds(serverIds, recallSimulations(ws.workspace_id));
  const refs: ProvenanceSimulationRef[] = await Promise.all(
    ids.map(async (id) => {
      try {
        const sim = await qc.fetchQuery({
          queryKey: qk.simulation(id, ws.workspace_id),
          staleTime: Infinity,
          queryFn: ({ signal }) => apiGetParsed(`/api/v10/evolution/simulations/${encodeURIComponent(id)}`, SimulationSchema, signal),
        });
        return sim.workspace_id === ws.workspace_id ? simulationRef(id, sim) : simulationRef(id, undefined);
      } catch {
        return simulationRef(id, undefined);
      }
    }),
  );
  const now = new Date();
  downloadJson(provenanceFilename(ws, now), buildProvenanceExport(ws, all, refs, now));
}
