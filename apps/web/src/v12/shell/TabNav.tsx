import * as Tabs from "@radix-ui/react-tabs";
import { Dna, GitBranch, Globe, Library } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TAB_ORDER, TAB_TITLES } from "../types";
import type { TabId } from "../types";

export const TAB_ICON: Record<TabId, LucideIcon> = {
  editor: Dna,
  evolution: GitBranch,
  simulation: Globe,
  library: Library,
};

/** Compact labels for the phone tab bar. The accessible name is always the full TAB_TITLES entry. */
export const TAB_SHORT: Record<TabId, string> = {
  editor: "Editor",
  evolution: "Evolution",
  simulation: "Earth",
  library: "Library",
};

/**
 * Desktop/tablet tablist (Radix: role=tablist, roving tabindex, arrow keys with wrap, Home/End).
 * Must render inside <Tabs.Root>. Digits 1-4 are handled globally by App.
 */
export function TabNav() {
  return (
    <Tabs.List aria-label="Workspace sections" loop className="flex items-stretch gap-0.5 rounded-[12px] border border-line/15 bg-ink-900/60 p-1">
      {TAB_ORDER.map((id, i) => {
        const Icon = TAB_ICON[id];
        return (
          <Tabs.Trigger
            key={id}
            value={id}
            data-tab={id}
            aria-keyshortcuts={String(i + 1)}
            className="group relative flex min-h-[2.25rem] items-center gap-2 whitespace-nowrap rounded-[9px] px-3 text-sm font-medium text-fg-2 transition-colors duration-fast ease-out-quint hover:text-fg data-[state=active]:bg-ink-600/70 data-[state=active]:text-fg data-[state=active]:shadow-[inset_0_0_0_1px_rgb(var(--glacier)/0.28)] max-[1180px]:px-2.5 max-[1180px]:gap-1.5"
          >
            <Icon aria-hidden className="h-4 w-4 shrink-0 text-fg-3 transition-colors group-data-[state=active]:text-glacier" />
            <span>{TAB_TITLES[id]}</span>
            <span aria-hidden className="kbd ml-0.5 max-[1340px]:hidden">
              {i + 1}
            </span>
          </Tabs.Trigger>
        );
      })}
    </Tabs.List>
  );
}
