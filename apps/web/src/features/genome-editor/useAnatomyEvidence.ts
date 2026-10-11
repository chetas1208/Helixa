/**
 * Honest evidence reads for the editor drawer. Missing routes → unavailable, never invented rows.
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet, isApiError } from "../../v12/api/client";

export type EvidenceLoad<T> = { status: "empty" | "unavailable" | "ready"; items: T[]; emptyReason?: string };

function fail<T>(e: unknown): EvidenceLoad<T> {
  if (isApiError(e) && (e.notFound || e.unavailable || e.status === 0 || e.status === 400)) {
    return { status: "unavailable", items: [] };
  }
  throw e;
}

export function useAnatomyNode(anatomyId: string | null) {
  return useQuery({
    queryKey: ["v14-anatomy-node", anatomyId ?? "none"],
    enabled: !!anatomyId,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<EvidenceLoad<Record<string, unknown>>> => {
      try {
        const raw = await apiGet<Record<string, unknown>>(`/api/anatomy/${encodeURIComponent(anatomyId as string)}`, signal);
        const node = raw && typeof raw === "object" && "node" in raw ? (raw.node as Record<string, unknown>) : raw;
        return node ? { status: "ready", items: [node] } : { status: "empty", items: [], emptyReason: "No anatomy record for this id." };
      } catch (e) {
        return fail(e);
      }
    },
  });
}

export function useAnatomyGenes(anatomyId: string | null) {
  return useQuery({
    queryKey: ["v14-anatomy-genes", anatomyId ?? "none"],
    enabled: !!anatomyId,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<EvidenceLoad<Record<string, unknown>>> => {
      try {
        const raw = await apiGet<{ items?: Record<string, unknown>[]; empty_reason?: string }>(
          `/api/anatomy/${encodeURIComponent(anatomyId as string)}/genes`,
          signal,
        );
        const items = Array.isArray(raw?.items) ? raw.items : [];
        if (items.length === 0) return { status: "empty", items: [], emptyReason: raw?.empty_reason ?? "No genes with evidence in this tissue are listed yet." };
        return { status: "ready", items };
      } catch (e) {
        return fail(e);
      }
    },
  });
}

export function useGeneAssociations(geneId: string | null) {
  return useQuery({
    queryKey: ["v14-gene-assoc", geneId ?? "none"],
    enabled: !!geneId,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<EvidenceLoad<Record<string, unknown>>> => {
      try {
        const raw = await apiGet<{ associations?: Record<string, unknown>[] }>(
          `/api/genes/${encodeURIComponent(geneId as string)}/variants?assembly=GRCh38`,
          signal,
        );
        const items = Array.isArray(raw?.associations) ? raw.associations : [];
        if (items.length === 0) return { status: "empty", items: [], emptyReason: "No variants associated with related traits are listed yet." };
        return { status: "ready", items };
      } catch (e) {
        return fail(e);
      }
    },
  });
}
