import { useId, useState } from "react";
import type { ReactNode } from "react";
import { focusRing } from "./ui";

interface Props {
  title: ReactNode;
  /** One-line summary shown next to the title (e.g. current values), visible while collapsed. */
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/** Collapsible group: a plain disclosure button with aria-expanded. Content stays in the DOM order below it. */
export function Disclosure({ title, hint, defaultOpen = false, children, className = "" }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`border-t border-white/10 pt-2 first:border-t-0 first:pt-0 ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-[32px] w-full items-center gap-2 rounded text-left ${focusRing}`}
      >
        <span aria-hidden className={`inline-block w-3 text-[10px] text-cyan-200 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="shrink-0 text-[13px] font-semibold text-slate-100">{title}</span>
        {hint && <span className="ml-auto min-w-0 truncate text-xs text-slate-300">{hint}</span>}
      </button>
      {open && (
        <div id={id} className="mt-2 space-y-3 pb-1">
          {children}
        </div>
      )}
    </section>
  );
}

/** Text clamped to `lines`; long text gets a Show more / Show less toggle. */
export function ClampedText({ text, lines = 3, className = "" }: { text: string; lines?: 2 | 3; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > (lines === 3 ? 160 : 100);
  return (
    <div className={className}>
      <p className={`text-[13px] leading-relaxed text-slate-100 ${!open && long ? (lines === 3 ? "line-clamp-3" : "line-clamp-2") : ""}`}>{text}</p>
      {long && (
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`mt-0.5 rounded text-xs text-cyan-200 underline-offset-2 hover:underline ${focusRing}`}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
