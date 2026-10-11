import { CheckCircle2, Circle, Loader2, OctagonX, PencilLine } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_HINT } from "./editorModel";
import type { EditorStatus } from "./editorModel";

const STYLE: Record<EditorStatus, { icon: ReactNode; cls: string }> = {
  Baseline: { icon: <Circle className="h-3.5 w-3.5" aria-hidden />, cls: "border-sky-300/40 text-sky-100" },
  Draft: { icon: <PencilLine className="h-3.5 w-3.5" aria-hidden />, cls: "border-amber-300/60 text-amber-100 border-dashed" },
  Validated: { icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />, cls: "border-emerald-300/50 text-emerald-100" },
  Unsupported: { icon: <OctagonX className="h-3.5 w-3.5" aria-hidden />, cls: "border-rose-300/50 text-rose-100" },
  "Analysis pending": { icon: <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />, cls: "border-violet-300/50 text-violet-100" },
};

/** Status chip: icon + text (never colour alone). Announced politely when it changes. */
export function StatusChip({ status }: { status: EditorStatus }) {
  const s = STYLE[status];
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid="editor-status"
      data-status={status}
      title={STATUS_HINT[status]}
      className={`inline-flex items-center gap-1.5 rounded-full border bg-slate-950/55 px-2.5 py-1 text-xs font-medium backdrop-blur ${s.cls}`}
    >
      {s.icon}
      <span>{status}</span>
    </span>
  );
}
