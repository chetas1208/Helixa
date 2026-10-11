import { ChevronDown, ChevronUp, X } from "lucide-react";
import { EvidenceBadge } from "../design/EvidenceBadge";
import type { Nucleotide } from "../types";
import { NUCLEOTIDES, substitutionClass } from "./editorModel";
import type { BaseSelectionInfo } from "./editorModel";

export interface BaseInspectorProps {
  info: BaseSelectionInfo;
  contig: string;
  collapsed: boolean;
  onToggle: () => void;
  onChoose: (alt: Nucleotide) => void;
  onRemoveDraft: () => void;
  onClear: () => void;
  disabled?: boolean;
  /** Phones: when collapsed keep the A/C/G/T row visible so a manual edit stays one tap away. */
  compact?: boolean;
  className?: string;
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 py-1">
    <dt className="text-xs text-slate-300">{k}</dt>
    <dd className="text-right font-mono text-sm text-slate-50">{children}</dd>
  </div>
);

/**
 * Detail inspector. Appears only once a base is selected and is collapsible.
 * Shows coordinate, reference, complement and the proposed alt; offers manual A/C/G/T draft choices.
 */
export function BaseInspector({ info, contig, collapsed, onToggle, onChoose, onRemoveDraft, onClear, disabled, compact, className = "" }: BaseInspectorProps) {
  const edited = info.proposedAlt !== null;
  const cls = edited ? substitutionClass(info.saved, info.proposedAlt as string) : "none";
  const altGroup = (
  <fieldset disabled={disabled}>
            <legend className="mb-1.5 text-xs text-slate-300">Draft this base as</legend>
            <div className="flex gap-1.5" role="group" aria-label="Choose a replacement base">
              {NUCLEOTIDES.map((nt) => {
                const isCurrent = nt === info.saved;
                const isDraft = info.proposedAlt === nt;
                return (
                  <button
                    key={nt}
                    type="button"
                    onClick={() => (isCurrent ? onRemoveDraft() : onChoose(nt))}
                    disabled={isCurrent && !edited}
                    aria-pressed={isDraft}
                    aria-label={isCurrent ? `${nt}, current base${edited ? ", click to undo the draft change" : ""}` : `Change to ${nt}`}
                    title={isCurrent ? "Current base" : `Draft ${info.saved} to ${nt}`}
                    data-testid={`alt-${nt}`}
                    className={`h-9 w-9 rounded-lg border font-mono text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${
                      isDraft ? "border-amber-300 bg-amber-400/20 text-amber-50" : isCurrent ? "border-white/20 bg-white/5 text-slate-300" : "border-white/20 text-slate-50 hover:bg-white/10"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {nt}
                    {isDraft && <span aria-hidden className="sr-only"> draft</span>}
                  </button>
                );
              })}
              {edited && (
                <button type="button" onClick={onRemoveDraft} className="ml-auto rounded-lg px-2 text-xs text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                  Remove draft change
                </button>
              )}
            </div>
          </fieldset>

  );

  return (
    <aside aria-label={`Selected base ${info.position}`} data-testid="base-inspector" className={`glass-strong pointer-events-auto rounded-xl text-sm ${className}`}>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <span className="font-mono text-slate-50" data-testid="inspector-coordinate">{contig}:{info.position}</span>
          <span className="font-mono text-slate-300" aria-hidden>
            {info.draft}
            <span className="text-slate-500"> / </span>
            {info.complementOfDraft ?? "?"}
          </span>
          {collapsed ? <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronUp className="ml-auto h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
          <span className="sr-only">{collapsed ? "Expand details" : "Collapse details"}</span>
        </button>
        <button type="button" onClick={onClear} aria-label="Clear selection" className="rounded-md p-1 text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {collapsed && compact && (
        <div className="border-t border-white/10 px-3 pb-2.5 pt-2">{altGroup}</div>
      )}

      {!collapsed && (
        <div className="border-t border-white/10 px-3 pb-3 pt-2">
          <dl className="divide-y divide-white/5">
            <Row k="Reference (observed)">
              {info.reference} <span className="text-slate-400">pairs with</span> {info.complementOfReference ?? "?"}
            </Row>
            {info.changedInSaved && <Row k="Saved version">{info.saved} <span className="text-slate-400">pairs with</span> {complementText(info.saved)}</Row>}
            <Row k="Proposed alt">
              {edited ? (
                <>
                  <span className="font-semibold text-amber-200">{info.proposedAlt}</span> <span className="text-slate-400">pairs with</span> {complementText(info.proposedAlt as string)}
                </>
              ) : (
                <span className="text-slate-400">none</span>
              )}
            </Row>
          </dl>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <EvidenceBadge kind="REFERENCE" label="Reference base" />
            {edited && <EvidenceBadge kind="HYPOTHESIS" label={`Unsaved ${cls === "none" ? "change" : cls}`} />}
          </div>

          <div className="mt-3">{altGroup}</div>

          <p className="mt-3 text-xs leading-5 text-slate-300" data-testid="no-body-effect">
            <strong className="font-medium text-slate-100">No validated body-level effect available.</strong> The body figure is illustrative and does not change with sequence edits.
          </p>
        </div>
      )}
    </aside>
  );
}

function complementText(b: string): string {
  return b === "A" ? "T" : b === "T" ? "A" : b === "C" ? "G" : b === "G" ? "C" : "?";
}
