import { useEffect, useRef } from "react";
import { MonitorOff } from "lucide-react";
import { useRenderPrefs } from "./renderPrefs";
import type { WebglStatus } from "./renderPrefs";
import { toast } from "./toast";

const COPY: Record<Exclude<WebglStatus, "ok" | "checking">, { title: string; body: string }> = {
  lost: {
    title: "3D view paused: graphics context lost",
    body: "The browser reclaimed the graphics context, so a 2D illustration is shown. Use Retry 3D in the top bar to restart it.",
  },
  error: {
    title: "A 3D scene failed to render",
    body: "Panels and data still work, and every 3D action stays available in the list view. Use Retry 3D in the top bar to try again.",
  },
  unsupported: {
    title: "3D view unavailable on this device",
    body: "WebGL could not start, so a lightweight 2D illustration is shown. Every action remains available through the panels.",
  },
};

/** One toast per transition into a degraded 3D state (no persistent overlay: it would cover tab content). */
export function useRenderStatusToasts() {
  const webgl = useRenderPrefs((s) => s.webgl);
  const detail = useRenderPrefs((s) => s.webglDetail);
  const last = useRef<WebglStatus>("checking");
  useEffect(() => {
    if (webgl === last.current) return;
    last.current = webgl;
    if (webgl === "ok" || webgl === "checking") return;
    const c = COPY[webgl];
    toast({ title: c.title, description: detail ? `${c.body} (${detail})` : c.body, tone: "warn", duration: 12000 });
  }, [webgl, detail]);
}

/** Top-bar chip, only while the 3D view is not running. Click retries the renderer. */
export function RenderChip() {
  const webgl = useRenderPrefs((s) => s.webgl);
  const retry = useRenderPrefs((s) => s.retryWebgl);
  if (webgl === "ok" || webgl === "checking") return null;
  const c = COPY[webgl];
  return (
    <button
      type="button"
      data-testid="render-chip"
      onClick={retry}
      title={`${c.title}. ${c.body}`}
      aria-label={`${c.title}. Retry 3D`}
      className="inline-flex h-9 items-center gap-1.5 rounded-control border border-ev-hypothesis/35 bg-ev-hypothesis/10 px-2.5 text-xs font-medium text-ev-hypothesis transition-colors duration-fast hover:bg-ev-hypothesis/15"
    >
      <MonitorOff aria-hidden className="h-3.5 w-3.5" />
      <span className="max-[1180px]:sr-only">2D view</span>
    </button>
  );
}
