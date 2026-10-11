import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { EvidenceBadge } from "../design/EvidenceBadge";
import type { DraftOp, EditDraft } from "../types";
import { complementOf, substitutionClass } from "./editorModel";
import type { DraftReview, ProposalEntry } from "./useDraftReview";

export interface ProposalPreviewProps {
  contig: string;
  draft: EditDraft;
  review: DraftReview;
  /** Remote change detected between draft base and workspace (blocks confirm). */
  conflictMessage: string | null;
  onRemove: (op: DraftOp) => void;
  onClose: () => void;
  onReloadKeep: () => void;
  onReloadDiscard: () => void;
}

function EntryStatus({ entry }: { entry: ProposalEntry | undefined }) {
  if (!entry || entry.state === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-violet-100" data-status="validating">
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden /> Validating
      </span>
    );
  }
  if (entry.state === "ready") return <span className="inline-flex items-center gap-1.5 text-emerald-100" data-status="ready"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Ready to review</span>;
  if (entry.state === "needs_review") {
    return (
      <span className="text-amber-100" data-status="needs-review">
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Needs your review</span>
        <span className="mt-0.5 block text-xs text-slate-300">{entry.proposal.reason}</span>
      </span>
    );
  }
  if (entry.state === "rejected") {
    return (
      <span className="text-rose-100" data-status="rejected">
        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Rejected</span>
        <span className="mt-0.5 block text-xs text-slate-300">{entry.proposal.reason || "The backend rejected this change."}</span>
      </span>
    );
  }
  return (
    <span className="text-slate-100" data-status="unavailable">
      <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Unavailable</span>
      <span className="mt-0.5 block text-xs text-slate-300">{entry.offline ? "The API is unreachable. The draft is kept; try again when it is back." : entry.message}</span>
    </span>
  );
}

/**
 * Proposal review: coordinate, change type, before/after, backend status/reason. The change stays a HYPOTHESIS
 * until the user confirms. Confirm = commit with expected_counter = the draft's base counter (409 -> conflict UI).
 */
export function ProposalPreview({ contig, draft, review, conflictMessage, onRemove, onClose, onReloadKeep, onReloadDiscard }: ProposalPreviewProps) {
  const saving = review.save.phase === "saving";
  const hasOps = draft.ops.length > 0;
  const canConfirm = hasOps && review.allValidated && !review.anyRejected && !review.anyError && !review.validating && !conflictMessage && !saving;
  const origins = new Set(draft.ops.map((o) => o.origin));
  const parsedLocally = origins.has("text") || origins.has("voice");

  return (
    <section aria-label="Proposed edit review" data-testid="proposal-preview" className="glass-strong pointer-events-auto max-h-[40vh] w-full overflow-y-auto rounded-xl p-3 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-100">Review proposed change{draft.ops.length === 1 ? "" : "s"}</h3>
          <EvidenceBadge kind="HYPOTHESIS" label="Hypothesis until saved" />
          {parsedLocally && <span className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-slate-300" data-testid="parsed-locally">Parsed locally</span>}
        </div>
        <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Back to editing</button>
      </header>

      {!hasOps && review.save.phase !== "saved" && <p className="mt-2 text-slate-300">The draft is empty. Select a base or describe an edit.</p>}

      {hasOps && (
        <ul className="mt-2 divide-y divide-white/10">
          {draft.ops.map((op) => {
            const k = review.keyOf(op);
            const entry = review.entries[k];
            const cls = substitutionClass(op.ref, op.alt);
            return (
              <li key={op.position} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5" data-testid="proposal-row" data-position={op.position}>
                <span className="font-mono text-slate-100">
                  {contig}:{op.position}
                </span>
                <span className="inline-flex items-center gap-1.5 font-mono text-base" aria-label={`${op.ref} to ${op.alt}`} title={`Complement strand: ${complementOf(op.ref)} to ${complementOf(op.alt)}`}>
                  <span>{op.ref}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  <span className="font-semibold text-amber-200">{op.alt}</span>
                </span>
                <span className="text-xs text-slate-300">1-base substitution{cls !== "none" ? `, ${cls}` : ""}</span>
                <span className="ml-auto min-w-0 text-sm">
                  <EntryStatus entry={entry} />
                </span>
                <button type="button" onClick={() => onRemove(op)} disabled={saving} className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" aria-label={`Remove change at position ${op.position} from the draft`} title="Remove from draft">
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {conflictMessage && (
        <div className="mt-2 rounded-lg border border-amber-300/40 bg-amber-400/10 p-2.5 text-amber-50" role="alert" data-testid="preview-conflict">
          {conflictMessage}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={onReloadKeep} className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-2.5 py-1 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reload latest, keep my draft</button>
            <button type="button" onClick={onReloadDiscard} className="rounded-lg border border-white/25 px-2.5 py-1 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Reload latest, discard draft</button>
          </div>
        </div>
      )}

      {review.save.phase === "conflict" && (
        <div className="mt-2 rounded-lg border border-amber-300/40 bg-amber-400/10 p-2.5 text-amber-50" role="alert" data-testid="commit-conflict">
          <strong className="font-medium">Not saved: the workspace changed since this draft was started.</strong>
          <p className="mt-0.5 text-xs text-amber-100/90">{review.save.message}</p>
          {review.save.done > 0 && <p className="mt-0.5 text-xs">{review.save.done} of {review.save.total} change(s) were saved before the conflict. The rest stay in your draft.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => { review.dismissSave(); onReloadKeep(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-2.5 py-1 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Reload latest, keep my draft</button>
            <button type="button" onClick={() => { review.dismissSave(); onReloadDiscard(); }} className="rounded-lg border border-white/25 px-2.5 py-1 text-xs hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Reload latest, discard draft</button>
          </div>
        </div>
      )}

      {review.save.phase === "error" && (
        <p className="mt-2 rounded-lg border border-rose-300/40 bg-rose-500/10 p-2.5 text-rose-50" role="alert" data-testid="commit-error">
          Not saved. {review.save.message}
          {review.save.done > 0 ? ` ${review.save.done} of ${review.save.total} change(s) were saved first.` : " Your draft is unchanged."}
        </p>
      )}

      {review.anyError && (
        <p className="mt-2 text-xs text-slate-300">
          Validation could not run. <button type="button" onClick={review.retryValidation} className="underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Retry validation</button>
        </p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void review.commit()}
          disabled={!canConfirm}
          data-testid="confirm-save"
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/60 bg-emerald-400/15 px-3.5 py-2 text-sm font-medium text-emerald-50 hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:border-white/15 disabled:bg-white/5 disabled:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
        >
          {saving ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          {saving && review.save.phase === "saving" ? `Saving ${review.save.done + 1} of ${review.save.total}` : "Confirm and save as new version"}
        </button>
        <p className="min-w-[12rem] flex-1 text-xs leading-5 text-slate-300">
          Nothing is saved until you confirm. In-silico sequence change, not lab-verified. Research use only.
          {draft.ops.length > 1 ? ` The API commits one substitution at a time, so this creates ${draft.ops.length} versions.` : ""}
        </p>
      </footer>
    </section>
  );
}
