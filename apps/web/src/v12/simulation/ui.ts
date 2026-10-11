/** Shared class strings for Evolution + Earth Simulation DOM (Tailwind). Keeps focus rings and targets consistent. */
export const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300";
export const btn = `inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md border border-white/15 bg-white/[0.06] px-3 py-1.5 text-sm text-slate-100 transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;
export const btnPrimary = `inline-flex min-h-[40px] items-center justify-center gap-2 rounded-md border border-cyan-300/50 bg-cyan-400/15 px-4 py-2 text-sm font-medium text-cyan-50 transition-colors hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;
export const chip = (active: boolean) =>
  `inline-flex min-h-[32px] items-center rounded-full border px-3 py-1 text-xs transition-colors ${focusRing} ${
    active ? "border-cyan-300/70 bg-cyan-400/20 text-cyan-50" : "border-white/15 bg-white/[0.04] text-slate-300 hover:bg-white/[0.1]"
  }`;
export const input = `min-h-[34px] rounded-md border border-white/15 bg-black/30 px-2 py-1 font-mono text-sm text-slate-100 ${focusRing}`;
export const mono = "font-mono text-[12px] text-slate-200";
export const sectionTitle = "text-[13px] font-semibold text-slate-100";
export const muted = "text-xs leading-relaxed text-slate-300";

/** Categorical series colours (dark mode steps), validated for CVD separation: blue, orange, aqua. */
export const SERIES = { a: "#3987e5", b: "#d95926", c: "#199e70" } as const;
