import { useId } from "react";
import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";

export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300";
export const btnBase = `inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition ${focusRing} disabled:cursor-not-allowed disabled:opacity-45`;
export const btnPrimary = `${btnBase} border-cyan-300/60 bg-cyan-400/15 text-cyan-50 hover:bg-cyan-400/25`;
export const btnQuiet = `${btnBase} border-white/15 text-slate-200 hover:bg-white/10`;
export const fieldCls = `min-h-[38px] rounded-md border border-white/15 bg-white/[0.04] px-3 text-sm text-slate-100 placeholder:text-slate-300 ${focusRing}`;

/** Label/value pair; value is always rendered as text (never HTML). */
export function Field({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-300">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm text-slate-100 ${mono ? "font-mono text-[13px]" : ""}`}>{children}</dd>
    </div>
  );
}

/** Compact label/value row for dense cards. */
export function Row({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-baseline gap-2">
      <dt className="text-xs text-slate-300">{label}</dt>
      <dd className={`min-w-0 break-words text-sm text-slate-100 ${mono ? "font-mono text-[13px]" : ""}`}>{children}</dd>
    </div>
  );
}

export function ActivePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/60 bg-cyan-400/15 px-2 py-0.5 text-xs font-semibold text-cyan-100">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
      Active
    </span>
  );
}

/** A control that cannot work on this backend: focusable, announced as unavailable, explained on hover/focus. */
export function UnavailableAction({ label, reason, endpoint }: { label: string; reason: string; endpoint?: string }) {
  const descId = useId();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={descId}
          onClick={(e) => e.preventDefault()}
          className={`${btnBase} cursor-not-allowed border-dashed border-white/20 bg-transparent text-slate-400`}
        >
          {label}
        </button>
      </Tooltip.Trigger>
      <span id={descId} className="sr-only">
        Unavailable. {reason}{endpoint ? ` Needs ${endpoint}.` : ""}
      </span>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-[90] max-w-[18rem] rounded-md border border-white/15 bg-[#0b1220] px-3 py-2 text-xs leading-relaxed text-slate-200 shadow-xl"
        >
          {reason}
          {endpoint && <span className="mt-1 block font-mono text-slate-300">{endpoint}</span>}
          <Tooltip.Arrow className="fill-[#0b1220]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-sm font-semibold text-slate-100">{children}</h3>;
}
