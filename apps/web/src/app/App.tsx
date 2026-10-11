import { lazy, Suspense, useCallback, useEffect } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import "./fonts";
import { useHealth } from "../v12/api/hooks";
import { Skeleton } from "../v12/design/Skeleton";
import { SwitchGuardDialog } from "../v12/library/SwitchGuard";
import { ConnectionBanner } from "../v12/shell/ConnectionBanner";
import { useConnectionInfo } from "../v12/shell/connection";
import { ErrorBoundary } from "../v12/shell/ErrorBoundary";
import { useTabHotkeys } from "../v12/shell/hotkeys";
import { MobileTabBar } from "../v12/shell/MobileTabBar";
import { useRenderStatusToasts } from "../v12/shell/RenderNotice";
import { toast } from "../v12/shell/toast";
import { Toaster } from "../v12/shell/Toaster";
import { CompactTopBar, TopBar } from "../v12/shell/TopBar";
import { useMediaQuery } from "../v12/shell/useMediaQuery";
import { useReducedMotionSync } from "../v12/shell/useReducedMotionSync";
import { useSession } from "../v12/state/session";
import { useUrlSync } from "../v12/state/urlSync";
import { useAnatomyUrlSync } from "../v14/state/urlSync";
import { TAB_ORDER, TAB_TITLES } from "../v12/types";
import type { TabId } from "../v12/types";

// three / R3F live in the SceneHost chunk so first paint (CSS atmosphere + shell) does not wait for them.
const SceneHost = lazy(() => import("../v12/shell/SceneHost").then((m) => ({ default: m.SceneHost })));

// Tab modules are code-split: the 3D-heavy ones load on first visit and are prefetched when idle.
const loaders = {
  editor: () => import("../v12/editor/GenomeEditorTab").then((m) => ({ default: m.GenomeEditorTab })),
  evolution: () => import("../v12/evolution/EvolutionTab").then((m) => ({ default: m.EvolutionTab })),
  simulation: () => import("../v12/simulation/EarthSimulationTab").then((m) => ({ default: m.EarthSimulationTab })),
  library: () => import("../v12/library/HarnessLibraryTab").then((m) => ({ default: m.HarnessLibraryTab })),
} satisfies Record<TabId, () => Promise<{ default: React.ComponentType }>>;

const TAB_COMPONENT: Record<TabId, React.LazyExoticComponent<React.ComponentType>> = {
  editor: lazy(loaders.editor),
  evolution: lazy(loaders.evolution),
  simulation: lazy(loaders.simulation),
  library: lazy(loaders.library),
};

function TabFallback({ tab }: { tab: TabId }) {
  return (
    <div className="hud-pad grid h-full place-items-center">
      <div className="glass w-[min(26rem,100%)] space-y-3 p-5">
        <Skeleton className="h-5 w-40" label={`Loading ${TAB_TITLES[tab]}`} />
        <Skeleton className="h-3.5 w-full" label="Loading" />
        <Skeleton className="h-3.5 w-2/3" label="Loading" />
      </div>
    </div>
  );
}

function usePrefetchTabs() {
  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const run = () => TAB_ORDER.forEach((id) => void loaders[id]().catch(() => undefined));
    const handle = idle ? idle(run, { timeout: 4000 }) : window.setTimeout(run, 2500);
    return () => {
      if (!idle) window.clearTimeout(handle);
    };
  }, []);
}

export function App() {
  const activeTab = useSession((s) => s.activeTab);
  const setActiveTab = useSession((s) => s.setActiveTab);
  const workspaceId = useSession((s) => s.activeWorkspaceId);
  const compact = useMediaQuery("(max-width: 768px)");

  useReducedMotionSync();
  useHealth(); // mirrors real API health into session.connection
  const info = useConnectionInfo();
  const sync = useUrlSync(); // ?tab=&workspace= <-> session, bootstrap from server-active workspace
  useAnatomyUrlSync(); // ?anatomy=&gene=&locus= <-> useAnatomySelection
  usePrefetchTabs();
  useRenderStatusToasts();

  const onSelect = useCallback((t: TabId) => setActiveTab(t), [setActiveTab]);
  useTabHotkeys(onSelect);

  useEffect(() => {
    document.title = `${TAB_TITLES[activeTab]} · HELIXA`;
  }, [activeTab]);

  useEffect(() => {
    if (sync.notice) toast({ title: "Link adjusted", description: sync.notice, tone: "info" });
  }, [sync.notice]);

  const bannerOn = info.state === "offline" || info.state === "degraded";

  return (
    <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)} activationMode="automatic" asChild>
      <div data-banner={bannerOn} className="relative h-full w-full overflow-hidden bg-ink-950 font-sans text-fg">
        <a
          href="#hud-stage"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-control focus:bg-ink-800 focus:px-3 focus:py-2 focus:text-sm focus:text-glacier"
        >
          Skip to content
        </a>

        <Suspense
          fallback={
            <div className="scene-host" aria-hidden="true">
              <div className="scene-atmosphere" />
            </div>
          }
        >
          <SceneHost />
        </Suspense>

        <header className="fixed inset-x-0 top-0 z-30">
          {compact ? <CompactTopBar info={info} /> : <TopBar info={info} />}
          <ConnectionBanner info={info} />
        </header>

        <main id="hud-stage" className="hud-stage" aria-label="Workspace content">
          <h1 className="sr-only">{TAB_TITLES[activeTab]}</h1>
          {TAB_ORDER.map((id) => {
            const Tab = TAB_COMPONENT[id];
            return (
              <Tabs.Content key={id} value={id} className="stage-enter pointer-events-none h-full w-full focus:outline-none focus-visible:outline-none">
                <ErrorBoundary name={TAB_TITLES[id]} resetKey={workspaceId}>
                  <Suspense fallback={<TabFallback tab={id} />}>
                    <Tab />
                  </Suspense>
                </ErrorBoundary>
              </Tabs.Content>
            );
          })}
        </main>

        {compact && <MobileTabBar />}
        <Toaster />
        <SwitchGuardDialog />
      </div>
    </Tabs.Root>
  );
}
