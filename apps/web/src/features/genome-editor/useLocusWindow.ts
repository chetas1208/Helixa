/**
 * GET /api/genome-edit/loci/{id}/window. 404 → null (keep the synthetic 1–48 teaching strip).
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet, isApiError } from "../../v12/api/client";
import type { LocusWindow } from "../../v14/contracts";

function looksLikeWindow(raw: unknown): raw is LocusWindow {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return typeof o.locus_id === "string" && typeof o.bases === "string" && typeof o.start === "number" && typeof o.end === "number";
}

export async function fetchLocusWindow(locusId: string, signal?: AbortSignal): Promise<LocusWindow | null> {
  try {
    const raw = await apiGet<unknown>(`/api/genome-edit/loci/${encodeURIComponent(locusId)}/window`, signal);
    return looksLikeWindow(raw) ? raw : null;
  } catch (e) {
    if (isApiError(e) && (e.notFound || e.unavailable || e.status === 0)) return null;
    throw e;
  }
}

export function useLocusWindow(locusId: string | null) {
  return useQuery({
    queryKey: ["v14-locus-window", locusId ?? "none"],
    enabled: !!locusId,
    staleTime: 60_000,
    queryFn: ({ signal }) => fetchLocusWindow(locusId as string, signal),
  });
}
