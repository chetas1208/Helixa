import { test as base, expect, type Page, type Route } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { FakeBackend, type FakeOptions } from "../../tests/support/fakeBackend";
import { installProbes } from "./probe";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../../..");
export const SHOTS = path.join(REPO, "artifacts/frontend/v12/screenshots");
export const API = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8303}`;
fs.mkdirSync(SHOTS, { recursive: true });

export const TAB_NAMES = ["Genome Editor", "Genome & Harness Evolution", "Earth Evolution Sandbox", "Harness Library"] as const;

/** Console messages that are expected noise under software rendering and are NOT app defects. */
const BENIGN_CONSOLE = [
  /GPU stall due to ReadPixels/i,
  /GL Driver Message/i,
  /Automatic fallback to software WebGL/i,
  /WebGL: CONTEXT_LOST_WEBGL/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
];

export interface Collected {
  errors: string[];
  warnings: string[];
  pageErrors: string[];
  failedRequests: string[];
}

export const test = base.extend<{
  collected: Collected;
  fake: (opts?: FakeOptions) => Promise<FakeBackend>;
  tolerate: (re: RegExp) => void;
}>({
  collected: async ({ page }, use) => {
    const c: Collected = { errors: [], warnings: [], pageErrors: [], failedRequests: [] };
    page.on("console", (m) => {
      const t = m.text();
      if (BENIGN_CONSOLE.some((r) => r.test(t))) return;
      if (m.type() === "error") c.errors.push(t);
      else if (m.type() === "warning") c.warnings.push(t);
    });
    page.on("pageerror", (e) => c.pageErrors.push(String(e)));
    page.on("requestfailed", (r) => c.failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
    await installProbes(page);
    await use(c);
  },
  fake: async ({ page, collected }, use) => {
    void collected;
    await use(async (opts = {}) => {
      const be = new FakeBackend(opts);
      // only the backend: vite also serves /src/v12/api/*.ts modules, which must not be intercepted
      await page.route((u) => u.pathname.startsWith("/api/"), async (route: Route) => {
        const req = route.request();
        const url = new URL(req.url());
        let body: unknown;
        try {
          body = req.postData() ? JSON.parse(req.postData()!) : undefined;
        } catch {
          body = undefined;
        }
        const r = be.handle(req.method(), url.pathname + url.search, body, req.headers());
        if (r.abort) return route.abort("connectionrefused");
        if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
        return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.json) });
      });
      return be;
    });
  },
  tolerate: async ({ collected }, use) => {
    await use((re) => {
      for (const k of ["errors", "warnings", "pageErrors"] as const) collected[k] = collected[k].filter((m) => !re.test(m));
    });
  },
});
export { expect };

export async function shot(page: Page, name: string, full = false) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return file;
}

/** Assert that none of the given element boxes overlap each other (pairwise) and all lie inside the viewport. */
export async function assertNoOverlapAndInViewport(page: Page, selectors: string[], opts: { allowOverlap?: [string, string][] } = {}) {
  const vp = page.viewportSize()!;
  const boxes: { sel: string; b: { x: number; y: number; width: number; height: number } }[] = [];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0 || !(await loc.isVisible())) continue;
    const b = await loc.boundingBox();
    if (b) boxes.push({ sel, b });
  }
  const problems: string[] = [];
  for (const { sel, b } of boxes) {
    if (b.x < -1 || b.y < -1 || b.x + b.width > vp.width + 1 || b.y + b.height > vp.height + 1) problems.push(`${sel} outside viewport ${JSON.stringify(b)} vs ${vp.width}x${vp.height}`);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, c = boxes[j]!;
      if (opts.allowOverlap?.some(([x, y]) => (x === a.sel && y === c.sel) || (x === c.sel && y === a.sel))) continue;
      const ox = Math.min(a.b.x + a.b.width, c.b.x + c.b.width) - Math.max(a.b.x, c.b.x);
      const oy = Math.min(a.b.y + a.b.height, c.b.y + c.b.height) - Math.max(a.b.y, c.b.y);
      if (ox > 2 && oy > 2) problems.push(`${a.sel} overlaps ${c.sel} by ${Math.round(ox)}x${Math.round(oy)}`);
    }
  expect(problems, problems.join("\n")).toEqual([]);
  return boxes;
}

export const tabButton = (page: Page, name: (typeof TAB_NAMES)[number]) => page.getByRole("tab", { name, exact: true });

/** Waits for the app shell and returns once a tab strip is present. */
export async function openApp(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 30_000 });
}
