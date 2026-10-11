import { useId } from "react";
import type { TraitResearchProposal } from "../../v14/contracts";

export interface ResearchProposalCardProps {
  proposal: TraitResearchProposal;
  onDismiss: () => void;
}

const ROWS: { key: keyof TraitResearchProposal; label: string }[] = [
  { key: "user_intent", label: "User intent" },
  { key: "research_area", label: "Research area" },
  { key: "evidence", label: "Evidence" },
  { key: "candidate_edit", label: "Candidate edit" },
  { key: "dna_rendering", label: "DNA rendering" },
  { key: "body_rendering", label: "Body rendering" },
  { key: "approval", label: "Approval" },
];

const LEVELS = [
  { name: "DNA sequence", detail: "Exact bases appear only after a validated edit." },
  { name: "Molecular consequences", detail: "Transcripts and proteins stay uncomputed until a real edit exists." },
  { name: "Body and phenotype", detail: "The figure stays illustrative. A supported effect is shown only when a mapping exists." },
];

/** Research ledger for a trait wish. Approval cannot apply a sequence that has not been identified. */
export function ResearchProposalCard({ proposal, onDismiss }: ResearchProposalCardProps) {
  const noteId = useId();
  return (
    <section
      data-testid="research-proposal"
      aria-labelledby="research-proposal-title"
      className="glass-strong pointer-events-auto w-full max-w-[640px] overflow-hidden rounded-2xl border border-amber-200/30 text-left shadow-[0_18px_50px_rgba(2,6,23,0.45)]"
    >
      <header className="border-b border-white/10 px-4 py-3">
        <h2 id="research-proposal-title" className="text-display text-[1.35rem] leading-tight text-slate-50">
          HELIXA Genome Edit Proposal
        </h2>
        <p className="mt-1 max-w-[58ch] text-xs leading-5 text-slate-300">
          Illustrative result. No DNA sequence is proposed until evidence identifies one.
        </p>
      </header>
      <dl className="divide-y divide-white/10">
        {ROWS.map((row) => (
          <div key={row.key} className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-3 px-4 py-2">
            <dt className="text-sm text-slate-400">{row.label}</dt>
            <dd className="text-sm leading-5 text-slate-50" data-testid={`research-${row.key}`}>{proposal[row.key]}</dd>
          </div>
        ))}
      </dl>
      <ol className="space-y-1.5 border-t border-white/10 px-4 py-3">
        {LEVELS.map((level, index) => (
          <li key={level.name} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 text-xs leading-5">
            <span className="font-mono text-slate-500">{index + 1}</span>
            <span>
              <span className="text-slate-100">{level.name}. </span>
              <span className="text-slate-400">{level.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
        <button
          type="button"
          disabled
          aria-describedby={noteId}
          data-testid="research-approve"
          className="inline-flex h-9 cursor-not-allowed items-center rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-400"
        >
          Approve and apply
        </button>
        <button
          type="button"
          onClick={onDismiss}
          data-testid="research-dismiss"
          className="inline-flex h-9 items-center rounded-xl border border-white/20 px-3 text-sm text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
        >
          Dismiss
        </button>
        <p id={noteId} className="min-w-[16rem] flex-1 text-xs leading-5 text-slate-400">
          Approval stays closed until a candidate edit is identified. Nothing is saved.
        </p>
      </div>
    </section>
  );
}
