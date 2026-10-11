import type { HTMLAttributes, ReactNode } from "react";

/** Small keyboard hint, e.g. <Kbd>1</Kbd>. Decorative: pair with an accessible name elsewhere. */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd aria-hidden className={`kbd ${className}`}>
      {children}
    </kbd>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-ev-inconclusive",
  ok: "bg-ev-validated",
  warn: "bg-ev-hypothesis",
  danger: "bg-danger",
  info: "bg-glacier",
};

/** A coloured dot. Never the only signal: always render next to text. */
export function StatusDot({ tone = "neutral", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span aria-hidden className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={`absolute inset-0 animate-pulse-ring rounded-full ${TONE_DOT[tone]} opacity-60`} />}
      <span className={`relative h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
    </span>
  );
}

/** Pill for neutral metadata (counts, ids, scopes). Use EvidenceBadge for scientific claims. */
export function Chip({ children, className = "", ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`chip ${className}`} {...rest}>
      {children}
    </span>
  );
}

/** Mono coordinate / hash / id text with tabular figures. */
export function Coord({ children, className = "", ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`coord ${className}`} {...rest}>
      {children}
    </span>
  );
}

/** Section heading inside a panel or tab. `serif` uses the display face for hero-level titles only. */
export function SectionTitle({ children, serif = false, className = "" }: { children: ReactNode; serif?: boolean; className?: string }) {
  return <h3 className={`${serif ? "text-display text-xl" : "text-sm font-semibold"} text-fg ${className}`}>{children}</h3>;
}
