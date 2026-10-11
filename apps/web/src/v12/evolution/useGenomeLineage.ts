import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet } from "../api/client";
import type { Workspace } from "../types";
import type { LineageRevision, WorkspaceLineage } from "./genomeModel";

const Schema = z.object({
  workspace_id: z.string(),
  nodes: z.array(z.object({ genome_revision_id: z.string(), parent_revision_id: z.string().nullable(), edit_count: z.number(), sequence_sha256: z.string() })),
});

const WorkspaceHarnessSchema = z.object({
  workspace_id: z.string(),
  distinct_from_genome: z.boolean().optional(),
  nodes: z.array(z.object({ harness_version_id: z.string(), parent_harness_version_id: z.string().nullable().optional(), note: z.string().optional() })),
});
export type WorkspaceHarness = z.infer<typeof WorkspaceHarnessSchema>;

/** GET /api/v10/genome/workspaces/{id}/genome-lineage: ids, parents, edit counts, hashes. A 404 means the route is absent. */
const lineageQuery = (workspaceId: string | null) => ({
  queryKey: ["genome-lineage", workspaceId ?? "none"],
  enabled: !!workspaceId,
  retry: false,
  staleTime: 5_000,
  queryFn: async ({ signal }: { signal?: AbortSignal }): Promise<LineageRevision[]> => {
    const out = Schema.parse(await apiGet(`/api/v10/genome/workspaces/${encodeURIComponent(workspaceId!)}/genome-lineage`, signal));
    if (out.workspace_id !== workspaceId) throw new Error(`Lineage belongs to workspace ${out.workspace_id}, not ${workspaceId}.`);
    return out.nodes;
  },
});

export const useGenomeLineage = (workspaceId: string | null) => useQuery(lineageQuery(workspaceId));

const MAX_LINEAGES = 16;

/**
 * Lineages of every listed workspace (capped), so a branch recorded in another workspace can be joined by id.
 * Workspaces whose lineage fails to load are simply absent (no inferred links).
 */
export function useAllLineages(workspaces: readonly Workspace[] | undefined): { data: WorkspaceLineage[]; loading: boolean } {
  const list = (workspaces ?? []).slice(0, MAX_LINEAGES);
  const results = useQueries({ queries: list.map((w) => lineageQuery(w.workspace_id)) });
  const stamp = results.map((r) => r.dataUpdatedAt).join(",");
  const data = useMemo(
    () =>
      list.flatMap((w, i) => {
        const nodes = results[i]?.data;
        return nodes ? [{ workspaceId: w.workspace_id, name: w.name, nodes, active: w.active_revision ?? null }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, stamp],
  );
  return { data, loading: results.some((r) => r.isLoading) };
}

/** GET .../harness-lineage: the analysis harness this workspace records (distinct from genome revisions). */
export const useWorkspaceHarness = (workspaceId: string | null) =>
  useQuery({
    queryKey: ["workspace-harness-lineage", workspaceId ?? "none"],
    enabled: !!workspaceId,
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<WorkspaceHarness> => {
      const out = WorkspaceHarnessSchema.parse(await apiGet(`/api/v10/genome/workspaces/${encodeURIComponent(workspaceId!)}/harness-lineage`, signal));
      if (out.workspace_id !== workspaceId) throw new Error(`Harness lineage belongs to workspace ${out.workspace_id}, not ${workspaceId}.`);
      return out;
    },
  });
