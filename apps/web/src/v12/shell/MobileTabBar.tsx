import * as Tabs from "@radix-ui/react-tabs";
import { TAB_ORDER, TAB_TITLES } from "../types";
import { TAB_ICON, TAB_SHORT } from "./TabNav";

/** Phone tab bar (<= 768px). Same Radix tablist semantics as the desktop nav; 56px high, 44px+ targets. */
export function MobileTabBar() {
  return (
    <nav
      aria-label="Sections"
      className="glass-strong fixed inset-x-0 bottom-0 z-30 rounded-none border-x-0 border-b-0"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <Tabs.List aria-label="Workspace sections" loop className="grid h-14 grid-cols-4">
        {TAB_ORDER.map((id) => {
          const Icon = TAB_ICON[id];
          return (
            <Tabs.Trigger
              key={id}
              value={id}
              data-tab={id}
              aria-label={TAB_TITLES[id]}
              className="group relative flex flex-col items-center justify-center gap-0.5 text-xs font-medium text-fg-3 transition-colors duration-fast data-[state=active]:text-fg"
            >
              <span aria-hidden className="absolute inset-x-5 top-0 h-px bg-glacier opacity-0 transition-opacity duration-fast group-data-[state=active]:opacity-100" />
              <Icon aria-hidden className="h-5 w-5 group-data-[state=active]:text-glacier" />
              <span aria-hidden>{TAB_SHORT[id]}</span>
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
    </nav>
  );
}
