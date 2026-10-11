import type { Page } from "@playwright/test";

/**
 * Browser-side probes installed with addInitScript BEFORE the app boots:
 *  - counts WebGL contexts (created / still-connected canvases / lost)
 *  - records long tasks (>50 ms)
 *  - records localStorage/sessionStorage/IndexedDB writes for the privacy audit
 *  - exposes window.__probe.fps(ms) for rAF-based frame pacing
 * Everything measured here is software rendered (SwiftShader) in this environment.
 */
export async function installProbes(page: Page, opts: { disableWebGL?: boolean } = {}) {
  await page.addInitScript((o) => {
    const w = window as unknown as Record<string, any>;
    const probe: any = { created: 0, canvases: [] as WeakRef<HTMLCanvasElement>[], lost: 0, lostConnected: 0, longTasks: [] as number[], storageWrites: [] as string[], idbOpens: [] as string[], creations: [] as { type: string; connected: boolean; w: number; h: number; stack: string }[] };
    w.__probe = probe;
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) {
        if (o.disableWebGL) return null;
        const ctx = (orig as any).call(this, type, ...rest);
        if (ctx && !(this as any).__counted) {
          (this as any).__counted = true;
          probe.created += 1;
          probe.creations.push({ type, connected: this.isConnected, w: this.width, h: this.height, stack: (new Error().stack ?? "").split("\n").slice(2, 6).map((l) => l.trim().replace(/\?t=\d+/, "")).join(" | ") });
          probe.canvases.push(new WeakRef(this));
          this.addEventListener("webglcontextlost", () => { probe.lost += 1; if (this.isConnected) probe.lostConnected += 1; });
        }
        return ctx;
      }
      return (orig as any).call(this, type, ...rest);
    };
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => probe.longTasks.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
    } catch {
      /* longtask unsupported */
    }
    const rec = (area: string) => (orig2: Storage["setItem"]) =>
      function (this: Storage, k: string, v: string) {
        probe.storageWrites.push(`${area}:${k}=${String(v).slice(0, 4000)}`);
        return orig2.call(this, k, v);
      };
    try {
      Storage.prototype.setItem = rec("storage")(Storage.prototype.setItem);
      const idbOpen = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name: string, v?: number) => (probe.idbOpens.push(name), idbOpen(name, v));
    } catch {
      /* storage blocked */
    }
    probe.liveCanvases = () => probe.canvases.map((r: WeakRef<HTMLCanvasElement>) => r.deref()).filter((c: HTMLCanvasElement | undefined) => c && c.isConnected).length;
    probe.fps = (ms: number) =>
      new Promise((resolve) => {
        const t: number[] = [];
        const t0 = performance.now();
        const tick = (now: number) => {
          t.push(now);
          if (now - t0 < ms) requestAnimationFrame(tick);
          else {
            const d = t.slice(1).map((x, i) => x - t[i]!).sort((a, b) => a - b);
            const mean = d.reduce((s, x) => s + x, 0) / Math.max(1, d.length);
            resolve({ frames: t.length, seconds: (t[t.length - 1]! - t[0]!) / 1000, meanFps: 1000 / mean, p95ms: d[Math.floor(d.length * 0.95)] ?? 0, maxMs: d[d.length - 1] ?? 0, over50ms: d.filter((x) => x > 50).length });
          }
        };
        requestAnimationFrame(tick);
      });
  }, opts);
}

export interface FpsStats {
  frames: number;
  seconds: number;
  meanFps: number;
  p95ms: number;
  maxMs: number;
  over50ms: number;
}
export const measureFps = (page: Page, ms: number) => page.evaluate((m) => (window as any).__probe.fps(m) as Promise<FpsStats>, ms);
export const liveCanvases = (page: Page) => page.evaluate(() => (window as any).__probe?.liveCanvases?.() as number);
export const probeSnapshot = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__probe;
    return { creations: p.creations as { type: string; connected: boolean; w: number; h: number; stack: string }[], created: p.created as number, live: p.liveCanvases() as number, lost: p.lost as number, lostConnected: p.lostConnected as number, longTasks: p.longTasks as number[], storageWrites: p.storageWrites as string[], idbOpens: p.idbOpens as string[] };
  });
