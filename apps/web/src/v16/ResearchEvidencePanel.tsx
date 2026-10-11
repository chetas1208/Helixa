import { useEffect, useState } from "react";
import { apiGetParsed, apiPost, apiPostParsed, isApiError } from "../v12/api/client";
import { ResearchSearchSchema, ResearchStatusSchema } from "./schema";
import type { ResearchSearch, ResearchStatus } from "./schema";

const PROMPTS: Record<string, string> = {
  editor: "public evidence for the selected gene or organ",
  evolution: "prior harness failure and in-silico lineage",
  simulation: "Wright-Fisher parameter assumptions",
  library: "workspace id stays exact",
};

/**
 * Compact research citations. Does not send sequence, and does not change workspace selection.
 */
export function ResearchEvidencePanel({
  surface,
  geneId,
  anatomyId,
  assembly,
  workspaceId,
}: {
  surface: "editor" | "evolution" | "simulation" | "library";
  geneId?: string | null;
  anatomyId?: string | null;
  assembly?: string | null;
  workspaceId?: string | null;
}) {
  const [health, setHealth] = useState<ResearchStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [query, setQuery] = useState(PROMPTS[surface]);
  const [result, setResult] = useState<ResearchSearch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [inv, setInv] = useState<{ proposal?: { status?: string; reason?: string }; claims?: { text: string; type: string }[]; source_status?: { source_id: string; status: string }[] } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    apiGetParsed("/api/v16/research/status", ResearchStatusSchema, ctrl.signal)
      .then((body) => {
        setHealth(body);
        setHealthError(null);
      })
      .catch((reason: unknown) => {
        if (ctrl.signal.aborted) return;
        setHealthError(isApiError(reason) ? reason.detail : "Retrieval status unavailable");
      });
    return () => ctrl.abort();
  }, []);

  async function investigateSources() {
    setPending(true);
    setError(null);
    try {
      const body = await apiPost<typeof inv>("/api/research/investigations", {
        text: query,
        workspace_id: workspaceId || null,
      });
      setInv(body);
    } catch (reason: unknown) {
      setInv(null);
      setError(isApiError(reason) ? reason.detail : "Source investigation failed");
    } finally {
      setPending(false);
    }
  }

  async function search() {
    setPending(true);
    setError(null);
    try {
      const body = await apiPostParsed("/api/v16/research/search", {
        query,
        top_k: 4,
        policy: "exact_vector_rerank",
        context: {
          task_type: surface,
          gene_id: geneId || null,
          anatomy_id: anatomyId || null,
          assembly: assembly || null,
          workspace_id: workspaceId || null,
        },
      }, ResearchSearchSchema);
      setResult(body);
    } catch (reason: unknown) {
      setResult(null);
      setError(isApiError(reason) ? reason.detail : "Research search failed");
    } finally {
      setPending(false);
    }
  }

  const label = health?.health ?? (healthError ? "unavailable" : "…");

  return (
    <details className="pointer-events-auto rounded-lg border border-white/15 bg-slate-950/80 p-2 text-xs text-slate-100 backdrop-blur" data-testid={`research-evidence-${surface}`}>
      <summary className="cursor-pointer font-medium">Research evidence · {label}</summary>
      <p className="mt-2 text-slate-300" data-testid="research-disclaimer">
        Citations only. Not causation, and not a genotype-to-phenotype result. Retrieved text does not change the figure, the simulation, or the active workspace.
      </p>
      {healthError && <p className="mt-1 text-amber-100">{healthError}</p>}
      {health && (
        <p className="mt-1 text-slate-400" data-testid="research-health">
          {health.verified ? "Voyage connected" : `Voyage ${health.health}`}
          {health.embedding_model ? ` · ${health.embedding_model}` : ""}
          {health.vector_search.active ? " · Atlas Vector Search active" : " · Atlas Vector Search not active"}
        </p>
      )}
      <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <input
          aria-label={`Research query for ${surface}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded border border-white/20 bg-slate-900 px-2 py-1"
        />
        <button type="submit" className="rounded border border-white/25 px-2 py-1" disabled={pending}>
          {pending ? "Searching" : "Search"}
        </button>
        <button type="button" className="rounded border border-white/25 px-2 py-1" disabled={pending} onClick={() => void investigateSources()}>
          Check sources
        </button>
      </form>
      {surface === "library" && (
        <p className="mt-1 text-slate-400">Workspace cards still match name and id exactly. This search does not activate one.</p>
      )}
      {surface === "evolution" && (
        <p className="mt-1 text-slate-400">In-silico harness lineage, not natural evolutionary ancestry.</p>
      )}
      {error && <p className="mt-2 text-amber-100" role="alert">{error}</p>}
      {inv && (
        <div className="mt-2 space-y-1" data-testid="source-investigation">
          <p className="text-slate-400">{inv.proposal?.status}: {inv.proposal?.reason}</p>
          <ul>
            {(inv.claims ?? []).map((claim) => (
              <li key={claim.text.slice(0, 80)}>{claim.type}: {claim.text}</li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <ul className="mt-2 space-y-2" data-testid="research-results">
          <li className="text-slate-400">{result.status}{result.fallback_reason ? ` · ${result.fallback_reason}` : ""} · {result.index.mode ?? "none"}</li>
          {result.citations.length === 0 && <li>No approved source matched.</li>}
          {result.citations.map((item) => (
            <li key={item.document_id} className="rounded border border-white/10 p-2">
              <p className="font-medium">{item.title}</p>
              <p className="mt-1 text-slate-300">{item.excerpt}</p>
              <p className="mt-1 text-slate-400">{item.evidence_type} · {item.provenance}</p>
              <a className="text-cyan-200 underline" href={item.source_url}>{item.document_id}</a>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
