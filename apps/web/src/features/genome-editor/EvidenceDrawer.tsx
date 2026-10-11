import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { UnavailableNotice } from "../../v12/design/UnavailableNotice";
import { useAnatomySelection } from "../../v14/state/anatomySelection";
import { LOCAL_ANATOMY } from "./localAnatomy";
import { useAnatomyGenes, useAnatomyNode, useGeneAssociations } from "./useAnatomyEvidence";
import type { EvidenceLoad } from "./useAnatomyEvidence";
import { AnatomyTree } from "../anatomy/AnatomyTree";

export type DrawerSection = "anatomy" | "genes" | "associations" | "sequence";

export interface EvidenceDrawerProps {
  open: boolean;
  section?: DrawerSection | null;
  onSection?: (s: DrawerSection) => void;
  sequenceNote?: string;
  traitWhy?: string | null;
}

function Block({ title, open, onToggle, children, testid }: { title: string; open: boolean; onToggle: () => void; children: ReactNode; testid: string }) {
  return (
    <section data-testid={testid} className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-100 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
        {title}
      </button>
      {open && <div className="px-3 pb-3 text-sm text-slate-200">{children}</div>}
    </section>
  );
}

function LoadState({ load, emptyTitle, ready }: { load: EvidenceLoad<Record<string, unknown>> | undefined; emptyTitle: string; ready: (items: Record<string, unknown>[]) => ReactNode }) {
  if (!load || load.status === "unavailable") {
    return <UnavailableNotice title="Evidence source unavailable" detail="This list is empty because the source did not answer. Nothing was invented." />;
  }
  if (load.status === "empty") {
    return <p className="text-slate-300" data-testid="evidence-empty">{load.emptyReason ?? emptyTitle}</p>;
  }
  return <>{ready(load.items)}</>;
}

/**
 * Evidence drawer: four stacked collapsible sections (not a tablist). Escape closes.
 * Positioned above the sequence strip so it never covers the bases.
 */
export function EvidenceDrawer({ open, section, onSection, sequenceNote, traitWhy }: EvidenceDrawerProps) {
  const anatomyId = useAnatomySelection((s) => s.anatomyId);
  const geneId = useAnatomySelection((s) => s.geneId);
  const locusId = useAnatomySelection((s) => s.locusId);
  const close = useAnatomySelection((s) => s.closeDrawer);
  const selectAnatomy = useAnatomySelection((s) => s.selectAnatomy);

  const nodeQ = useAnatomyNode(anatomyId);
  const genesQ = useAnatomyGenes(anatomyId);
  const assocQ = useGeneAssociations(geneId);

  const [openSet, setOpenSet] = useState<Record<DrawerSection, boolean>>({
    anatomy: true,
    genes: false,
    associations: false,
    sequence: false,
  });

  useEffect(() => {
    if (!section) return;
    setOpenSet((s) => ({ ...s, [section]: true }));
  }, [section]);

  useEffect(() => {
    if (anatomyId) {
      setOpenSet((s) => ({ ...s, anatomy: true, genes: true }));
    }
  }, [anatomyId]);

  useEffect(() => {
    if (geneId) {
      setOpenSet((s) => ({ ...s, associations: true }));
    }
  }, [geneId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) return null;

  const toggle = (k: DrawerSection) => {
    setOpenSet((s) => ({ ...s, [k]: !s[k] }));
    onSection?.(k);
  };

  const localHit = LOCAL_ANATOMY.find((a) => a.id === anatomyId);

  return (
    <aside
      role="complementary"
      aria-label="Evidence"
      data-testid="evidence-drawer"
      className="glass-strong pointer-events-auto absolute right-3 z-20 flex max-h-[min(65vh,36rem)] w-[min(28rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl max-[768px]:left-3 max-[768px]:right-3"
      style={{ bottom: "11.25rem" }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-50">Evidence</h2>
        <button type="button" onClick={close} aria-label="Close evidence" data-testid="evidence-close" className="rounded-md p-1 text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Block title="Anatomy" open={openSet.anatomy} onToggle={() => toggle("anatomy")} testid="evidence-anatomy">
          {anatomyId && (
            <div className="mb-3 rounded-lg border border-cyan-400/25 bg-cyan-950/40 p-2.5 text-xs">
              <LoadState
                load={nodeQ.data}
                emptyTitle="No anatomy record for this id."
                ready={(items) => {
                  const n = items[0] ?? {};
                  const label = typeof n.label === "string" ? n.label : localHit?.labels[0] ?? anatomyId;
                  return (
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-50">{label}</span>
                        <span className="font-mono text-[11px] text-cyan-300">{anatomyId}</span>
                      </div>
                      {typeof n.description === "string" && <p className="mt-1 text-slate-300">{n.description}</p>}
                    </div>
                  );
                }}
              />
              {anatomyId && !nodeQ.data && nodeQ.isLoading && <p className="text-slate-400">Loading anatomy…</p>}
              <button
                type="button"
                onClick={() => selectAnatomy(null)}
                className="mt-2 text-2xs text-cyan-300 hover:underline"
              >
                ← Clear selection & browse all
              </button>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto">
            <AnatomyTree />
          </div>
        </Block>

        <Block title="Genes expressed here" open={openSet.genes} onToggle={() => toggle("genes")} testid="evidence-genes">
          <div className="mb-2 space-y-1">
            <span className="inline-block rounded border border-cyan-400/40 bg-cyan-500/15 px-2 py-0.5 text-xs font-semibold text-cyan-200">
              Observed tissue expression
            </span>
            <p className="text-xs leading-relaxed text-slate-300">
              Genes with evidence in this tissue. Expression shows the gene is active in this tissue. It is not evidence that editing this gene will alter the anatomical structure.
            </p>
          </div>
          {!anatomyId ? (
            <p className="text-slate-300">Select a body part to list genes with evidence in that tissue.</p>
          ) : (
            <LoadState
              load={genesQ.data}
              emptyTitle="No genes with evidence in this tissue are listed yet."
              ready={(items) => (
                <ul className="space-y-2">
                  {items.slice(0, 12).map((g, i) => (
                    <li key={String(g.evidence_id ?? g.gene_id ?? i)} className="rounded-md bg-white/5 p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-medium text-slate-50">{String(g.gene_symbol ?? g.gene_id ?? "gene")}</span>
                        <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[10px] text-cyan-300">Observed tissue expression</span>
                      </div>
                      {typeof g.measured_anatomy_label === "string" && (
                        <span className="mt-0.5 block text-xs text-slate-400">Measured in {g.measured_anatomy_label}</span>
                      )}
                      <span className="mt-1 block text-xs text-slate-300">
                        {typeof g.caveat === "string" ? g.caveat : "Expression shows the gene is active in this tissue. It is not evidence that editing this gene will alter the anatomical structure."}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            />
          )}
        </Block>

        <Block title="Genetic associations" open={openSet.associations} onToggle={() => toggle("associations")} testid="evidence-associations">
          <div className="mb-2 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">GWAS Catalog REST API v2 study context</span>
              <span className="rounded border border-purple-400/30 bg-purple-500/15 px-1.5 py-0.5 text-[10px] text-purple-200">Statistical association</span>
            </div>
            <p className="text-xs text-slate-400">
              Variants associated with related traits. Curated gene–phenotype relationships are listed separately when a source provides them. Statistical association is not causation.
            </p>
          </div>
          {!geneId ? (
            <p className="text-slate-300">Select a gene to load associations. Statistical association is not causation.</p>
          ) : (
            <LoadState
              load={assocQ.data}
              emptyTitle="No variants associated with related traits are listed yet."
              ready={(items) => (
                <ul className="space-y-2">
                  {items.slice(0, 8).map((a, i) => (
                    <li key={String(a.association_id ?? i)} className="rounded-md bg-white/5 p-2 text-xs">
                      <span className="font-medium text-slate-100">{Array.isArray(a.reported_trait) ? a.reported_trait.join(", ") : "Associated trait"}</span>
                      <div className="mt-1 text-[11px] text-slate-300">
                        <span>Study: {String(a.study_accession ?? a.study_description ?? "GWAS Catalog association")}</span>
                        {a.pubmed_id ? <span> · PubMed: {String(a.pubmed_id)}</span> : null}
                      </div>
                      {a.p_value != null && <span className="mt-0.5 block font-mono text-slate-400">p {String(a.p_value)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            />
          )}
        </Block>

        <Block title="Sequence & edits" open={openSet.sequence} onToggle={() => toggle("sequence")} testid="evidence-sequence">
          {traitWhy && <p className="mb-2 text-slate-200" data-testid="trait-why">{traitWhy}</p>}
          <p className="text-slate-300">{sequenceNote ?? (locusId ? `Pinned locus ${locusId}.` : "Teaching strip: synthetic chr22 positions 1–48 until a GRCh38 locus is selected.")}</p>
          <p className="mt-2 text-xs text-slate-400">An edit is a draft until you confirm. The body never morphs.</p>
        </Block>
      </div>
    </aside>
  );
}
