import { EvidenceBadge } from "../design/EvidenceBadge";
import { Skeleton } from "../design/Skeleton";
import { isApiError } from "../api/client";
import { useListedSimulations, useRememberedSimulations, useSimulation, useWorkspaceCapabilities } from "../api/hooks";
import { mergeRunIds, shortId, summariseSimulation } from "./libraryModel";

/** Run ids for a workspace, newest first: server listing when the backend has it, plus ids remembered in this browser. */
export function useWorkspaceRunIds(workspaceId: string): { ids: string[]; source: "server+browser" | "browser"; loading: boolean } {
  const caps = useWorkspaceCapabilities();
  const serverListing = !!caps.data?.listSimulations;
  const listed = useListedSimulations(workspaceId, serverListing);
  const remembered = useRememberedSimulations(workspaceId);
  const serverIds = listed.data?.map((s) => s.simulation_id) ?? [];
  return { ids: mergeRunIds(serverIds, remembered), source: serverListing ? "server+browser" : "browser", loading: caps.isPending || (serverListing && listed.isPending) };
}

/** One run, fetched by id and validated to belong to this workspace. */
export function SimulationRunRow({ workspaceId, simulationId, detailed = false }: { workspaceId: string; simulationId: string; detailed?: boolean }) {
  const q = useSimulation(simulationId, workspaceId);
  if (q.isPending) return <Skeleton className="h-5 w-48" label="Loading simulation" />;
  if (q.isError) {
    return (
      <p className="text-sm text-amber-200">
        <span className="font-mono">{shortId(simulationId, 18)}</span>: could not be loaded ({isApiError(q.error) ? q.error.detail : "error"}).
      </p>
    );
  }
  const s = q.data;
  return (
    <div className="text-sm text-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <EvidenceBadge kind="SIMULATED" />
        <span className="font-mono text-[13px]">{shortId(s.simulation_id, 18)}</span>
      </div>
      <p className="mt-1 text-slate-300">{summariseSimulation(s)}</p>
      {detailed && (
        <p className="mt-0.5 break-all font-mono text-xs text-slate-300">
          seed {s.seed} / {s.engine_version} / revision {s.genome_revision_id} / result_sha256 {s.result_sha256}
        </p>
      )}
    </div>
  );
}

/** Latest run for a card; honest "none" otherwise. */
export function LatestSimulationLine({ workspaceId }: { workspaceId: string }) {
  const { ids, loading } = useWorkspaceRunIds(workspaceId);
  if (ids.length === 0) return loading ? <Skeleton className="h-5 w-40" label="Looking for simulations" /> : <p className="text-sm text-slate-300">No simulation recorded yet.</p>;
  return <SimulationRunRow workspaceId={workspaceId} simulationId={ids[0]} />;
}
