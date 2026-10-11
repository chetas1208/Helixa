import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useToasts } from "./toast";
import type { Toast, ToastTone } from "./toast";

const ICON: Record<ToastTone, typeof Info> = { info: Info, success: CheckCircle2, warn: AlertTriangle, error: AlertTriangle };
const TONE: Record<ToastTone, string> = {
  info: "text-glacier",
  success: "text-ev-validated",
  warn: "text-ev-hypothesis",
  error: "text-danger",
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const timer = useRef<number | undefined>(undefined);
  const Icon = ICON[toast.tone];

  const arm = () => {
    if (toast.duration <= 0) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => dismiss(toast.id), toast.duration);
  };
  useEffect(() => {
    arm();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <li
      role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={() => window.clearTimeout(timer.current)}
      onMouseLeave={arm}
      onFocus={() => window.clearTimeout(timer.current)}
      onBlur={arm}
      className="glass-solid pointer-events-auto flex w-[min(24rem,calc(100vw-1.5rem))] animate-toast-in items-start gap-3 px-3.5 py-3"
    >
      <Icon aria-hidden className={`mt-0.5 h-4 w-4 shrink-0 ${TONE[toast.tone]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{toast.title}</p>
        {toast.description && <p className="mt-0.5 break-words text-xs leading-relaxed text-fg-2">{toast.description}</p>}
      </div>
      <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification" className="btn-quiet -mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-control">
        <X aria-hidden className="h-4 w-4" />
      </button>
    </li>
  );
}

/** Bottom-right on desktop, above the tab bar on mobile. Text-only content (never HTML). */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <ol
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-[calc(var(--hud-bottom)+0.75rem)] right-3 z-50 flex flex-col items-end gap-2 max-md:left-3 max-md:items-stretch"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </ol>
  );
}
