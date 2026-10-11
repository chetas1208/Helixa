import { useEffect, useState } from "react";
import { ClipboardCheck, Columns2, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import type { CompareMode } from "./editorSceneStore";

export type CompareAgainst = "saved" | "baseline";

export interface DraftToolbarProps {
  opCount: number;
  canUndo: boolean;
  canRedo: boolean;
  canDiscard: boolean;
  canRestoreBaseline: boolean;
  canCompare: boolean;
  compareMode: CompareMode;
  compareAgainst: CompareAgainst;
  reviewOpen: boolean;
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDiscard: () => void;
  onRestoreBaseline: () => void;
  onCompareMode: (m: CompareMode) => void;
  onCompareAgainst: (c: CompareAgainst) => void;
  onReview: () => void;
}

const btn =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300";

/** Undo / Redo / Compare (one toggle: original beside draft) / Restore baseline / Discard / Review with correct disabled states. Nothing here commits. */
export function DraftToolbar(p: DraftToolbarProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    if (!confirmDiscard) return;
    const t = setTimeout(() => setConfirmDiscard(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDiscard]);
  useEffect(() => { if (!p.canDiscard) setConfirmDiscard(false); }, [p.canDiscard]);

  // Resting screen: nothing to undo, compare, restore or discard -> the toolbar is hidden (kept in the DOM, all disabled)
  // so it reserves no space above the figure.
  const compareOn = p.compareMode !== "off";
  const quiet = !p.canUndo && !p.canRedo && !p.canDiscard && !p.canRestoreBaseline && !p.canCompare && p.opCount === 0;
  return (
    <div role="toolbar" aria-label="Draft controls" data-testid="draft-toolbar" data-quiet={quiet ? "true" : "false"} className={`glass flex max-w-full flex-wrap items-center gap-1.5 rounded-xl p-1.5 max-[768px]:flex-nowrap max-[768px]:overflow-x-auto transition-opacity duration-200 motion-reduce:transition-none ${quiet ? "hidden" : "pointer-events-auto"}`}>
      <button type="button" className={btn} onClick={p.onUndo} disabled={!p.canUndo || p.busy} aria-label="Undo draft change" title="Undo (draft only)" data-testid="undo">
        <Undo2 className="h-4 w-4" aria-hidden /> <span className="max-[1100px]:sr-only">Undo</span>
      </button>
      <button type="button" className={btn} onClick={p.onRedo} disabled={!p.canRedo || p.busy} aria-label="Redo draft change" title="Redo (draft only)" data-testid="redo">
        <Redo2 className="h-4 w-4" aria-hidden /> <span className="max-[1100px]:sr-only">Redo</span>
      </button>

      <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden />

      <button
        type="button"
        aria-pressed={compareOn}
        disabled={!p.canCompare}
        onClick={() => p.onCompareMode(compareOn ? "off" : "split")}
        title={p.canCompare ? (compareOn ? "Hide the side-by-side comparison" : "Show the original helix beside the draft") : "Nothing to compare yet"}
        data-testid="compare-toggle"
        className={`${btn} ${compareOn ? "border-cyan-300/60 bg-cyan-400/20 text-cyan-50" : ""}`}
      >
        <Columns2 className="h-4 w-4" aria-hidden /> <span className="max-[1100px]:sr-only">Compare</span>
      </button>
      {compareOn && (
        <label className="flex items-center gap-1.5 text-xs text-slate-300">
          vs
          <select
            value={p.compareAgainst}
            onChange={(e) => p.onCompareAgainst(e.target.value as CompareAgainst)}
            className="h-8 rounded-md border border-white/15 bg-slate-950/70 px-1.5 text-sm text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
            aria-label="Compare the draft against"
          >
            <option value="saved">saved version</option>
            <option value="baseline">baseline</option>
          </select>
        </label>
      )}

      <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden />

      <button
        type="button"
        className={btn}
        onClick={p.onRestoreBaseline}
        disabled={!p.canRestoreBaseline || p.busy}
        title={p.canRestoreBaseline ? "Draft the baseline sequence as a NEW version. Saved versions are kept." : "The saved version already equals the baseline"}
        data-testid="restore-baseline"
      >
        <RotateCcw className="h-4 w-4" aria-hidden /> <span className="max-[1100px]:sr-only">Restore baseline</span>
      </button>
      <button
        type="button"
        className={`${btn} ${confirmDiscard ? "border-rose-300/70 bg-rose-500/15" : ""}`}
        onClick={() => { if (confirmDiscard) { setConfirmDiscard(false); p.onDiscard(); } else setConfirmDiscard(true); }}
        disabled={!p.canDiscard || p.busy}
        title="Discard the unsaved draft. Saved versions are not affected."
        data-testid="discard"
      >
        <Trash2 className="h-4 w-4" aria-hidden /> <span className={confirmDiscard ? "" : "max-[1100px]:sr-only"}>{confirmDiscard ? "Confirm discard" : "Discard"}</span>
      </button>

      {p.opCount > 0 && !p.reviewOpen && (
        <button type="button" onClick={p.onReview} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300/60 bg-amber-400/15 px-3 text-sm font-medium text-amber-50 hover:bg-amber-400/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200" data-testid="review-save">
          <ClipboardCheck className="h-4 w-4" aria-hidden /> Review and save ({p.opCount})
        </button>
      )}
    </div>
  );
}
