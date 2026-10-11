import { useEffect } from "react";
import { TAB_ORDER } from "../types";
import type { TabId } from "../types";

const TYPING_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton", "slider", "listbox"]);

/** True when a key press should be treated as text entry / widget navigation, not a global shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  const role = target.getAttribute("role");
  if (role && TYPING_ROLES.has(role)) return true;
  return !!target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]');
}

/** Pure mapping, exported for tests: "1".."4" -> tab id, otherwise null. */
export function tabForKey(key: string): TabId | null {
  if (!/^[1-9]$/.test(key)) return null;
  return TAB_ORDER[Number(key) - 1] ?? null;
}

/** Global digits 1-4 select a tab, ignoring modifiers, key repeat and typing targets. */
export function useTabHotkeys(onSelect: (tab: TabId) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const tab = tabForKey(e.key);
      if (tab) onSelect(tab);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect]);
}
