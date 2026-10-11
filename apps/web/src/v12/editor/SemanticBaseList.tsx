import { useEffect, useId, useRef } from "react";
import { complementOf, isNucleotide } from "./editorModel";
import type { Nucleotide } from "../types";

export interface BaseListProps {
  start: number;
  contig: string;
  baseline: string;
  saved: string;
  draft: string;
  selectedPosition: number | null;
  reducedMotion: boolean;
  onSelect: (position: number | null) => void;
  /** Typing A/C/G/T on a focused option proposes that base as a manual draft change. */
  onPropose: (position: number, alt: Nucleotide) => void;
}

/**
 * DOM mirror of the 3D helix: a keyboard-operable listbox of the loaded window's real bases.
 * Everything the helix can do by pointer (select a base, read coordinate/ref/complement/draft, propose a
 * change) is available here, with or without WebGL. Selection follows focus.
 */
export function SemanticBaseList({ start, contig, baseline, saved, draft, selectedPosition, reducedMotion, onSelect, onPropose }: BaseListProps) {
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const n = baseline.length;
  const activeIndex = selectedPosition === null ? -1 : selectedPosition - start;
  const optId = (i: number) => `${id}-opt-${i}`;

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = document.getElementById(optId(activeIndex));
    el?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: reducedMotion ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, reducedMotion]);

  const move = (i: number) => onSelect(start + Math.max(0, Math.min(n - 1, i)));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = activeIndex < 0 ? 0 : activeIndex;
    switch (e.key) {
      case "ArrowRight": case "ArrowDown": e.preventDefault(); move(activeIndex < 0 ? 0 : cur + 1); return;
      case "ArrowLeft": case "ArrowUp": e.preventDefault(); move(activeIndex < 0 ? 0 : cur - 1); return;
      case "Home": e.preventDefault(); move(0); return;
      case "End": e.preventDefault(); move(n - 1); return;
      case "PageDown": e.preventDefault(); move(cur + 10); return;
      case "PageUp": e.preventDefault(); move(cur - 10); return;
      case "Escape": if (activeIndex >= 0) { e.preventDefault(); onSelect(null); } return;
      default: break;
    }
    if (activeIndex >= 0 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      const up = e.key.toUpperCase();
      if (isNucleotide(up)) {
        e.preventDefault();
        onPropose(selectedPosition as number, up);
      }
    }
  };

  if (n === 0) return null;

  return (
    <div className="pointer-events-auto w-full max-w-[900px]">
      <div
        ref={listRef}
        role="listbox"
        aria-label={`Bases in the loaded window, ${contig} positions ${start} to ${start + n - 1}. Arrow keys move; type A, C, G or T to propose a change.`}
        aria-orientation="horizontal"
        aria-activedescendant={activeIndex >= 0 ? optId(activeIndex) : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={(e) => { if (activeIndex < 0 && e.currentTarget === e.target && e.currentTarget.matches(":focus-visible")) move(0); }}
        data-testid="base-list"
        className="glass flex snap-x overflow-x-auto rounded-xl px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 [scrollbar-width:thin]"
      >
        {Array.from({ length: n }, (_, i) => {
          const pos = start + i;
          const ref = baseline[i];
          const sv = saved[i];
          const dr = draft[i];
          const comp = complementOf(dr);
          const draftChanged = dr !== sv;
          const savedChanged = sv !== ref;
          const selected = pos === selectedPosition;
          const label =
            `Position ${pos}, reference ${ref}, complement ${complementOf(ref) ?? "unknown"}` +
            (savedChanged ? `, saved edit to ${sv}` : "") +
            (draftChanged ? `, unsaved draft ${dr}, draft complement ${comp ?? "unknown"}` : "");
          return (
            <div
              key={pos}
              id={optId(i)}
              role="option"
              aria-selected={selected}
              aria-label={label}
              data-position={pos}
              data-base={dr}
              data-draft={draftChanged ? "true" : "false"}
              onClick={() => onSelect(pos)}
              className={`relative flex w-[18px] shrink-0 cursor-pointer snap-center select-none flex-col items-center rounded-md px-0 py-0.5 font-mono text-[12px] leading-4 transition-colors ${
                selected ? "bg-cyan-300/20 ring-1 ring-cyan-200/80" : "hover:bg-white/10"
              }`}
            >
              <span className={`font-semibold ${draftChanged ? "text-amber-200" : savedChanged ? "text-sky-200" : "text-slate-100"}`}>{dr}</span>
              <span className="text-[11px] text-slate-300/80">{comp ?? "?"}</span>
              {/* shape cue for changes: dashed underline = unsaved draft, solid = saved edit */}
              <span
                aria-hidden
                className={`mt-0.5 block h-0 w-3 border-t-2 ${draftChanged ? "border-dashed border-amber-300" : savedChanged ? "border-solid border-sky-300" : "border-transparent"}`}
              />
              <span aria-hidden className="text-[10px] leading-3 text-slate-300">{pos === start || pos % 10 === 0 || pos === start + n - 1 ? pos : " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
