import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { focusRing } from "./ui";

export interface MenuItem {
  key: string;
  label: string;
  onSelect?: () => void;
  /** Rendered but inert, with the reason shown (never silently hidden). */
  disabledReason?: string;
}

/** Accessible overflow menu (button + role=menu): arrows/Home/End, Escape returns focus, outside click closes. */
export function OverflowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const menuH = items.length * 40 + 12;
    const below = r.bottom + 6 + menuH <= window.innerHeight;
    setPos({ top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - menuH), right: Math.max(8, window.innerWidth - r.right) });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false);
    };
    const onScroll = () => close(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close]);

  const onKey = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === "Tab") close(false);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`pointer-events-auto relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-transparent text-slate-300 transition hover:border-white/15 hover:bg-white/10 hover:text-white ${focusRing} ${open ? "bg-white/10 text-white" : ""}`}
      >
        <MoreHorizontal size={20} aria-hidden />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={label}
            onKeyDown={onKey}
            style={{ position: "fixed", top: pos?.top ?? -9999, right: pos?.right ?? 0 }}
            className="z-[85] min-w-[13rem] max-w-[17rem] rounded-xl border border-white/15 bg-[#0b1220]/98 p-1.5 shadow-2xl backdrop-blur"
          >
            {items.map((it) => {
              const disabled = !!it.disabledReason;
              return (
                <button
                  key={it.key}
                  role="menuitem"
                  type="button"
                  aria-disabled={disabled || undefined}
                  title={it.disabledReason}
                  onClick={() => {
                    if (disabled) return;
                    close(false);
                    it.onSelect?.();
                  }}
                  className={`flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm ${focusRing} ${
                    disabled ? "cursor-not-allowed text-slate-400" : "text-slate-100 hover:bg-white/10 focus:bg-white/10"
                  }`}
                >
                  {it.label}
                  {disabled && <span className="text-xs leading-snug text-slate-400">{it.disabledReason}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
