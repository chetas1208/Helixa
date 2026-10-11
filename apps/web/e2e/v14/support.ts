import { test as base, expect, type Page, type Request } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../../../..");
export const SHOTS = path.join(REPO, "artifacts/milestones/v14/shots");
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8145);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5145);
export const API = `http://127.0.0.1:${API_PORT}`;
fs.mkdirSync(SHOTS, { recursive: true });

if ([8000, 5173].includes(API_PORT) || [8000, 5173].includes(WEB_PORT)) {
  throw new Error("V14 e2e must not use the user's live ports 8000/5173");
}

export interface ApiCall {
  method: string;
  url: string;
  path: string;
  body: unknown;
  status?: number;
}

/** Abort any non-GET aimed at the user's live store. Never send mutations to :8000. */
export async function blockLiveStore(page: Page) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method().toUpperCase();
    if (/127\.0\.0\.1:8000|localhost:8000/.test(url) && method !== "GET") {
      return route.abort("failed");
    }
    if (/127\.0\.0\.1:5173|localhost:5173/.test(url) && method !== "GET") {
      return route.abort("failed");
    }
    return route.continue();
  });
}

export function assertNotLiveStore(req: Request) {
  const url = req.url();
  const method = req.method().toUpperCase();
  if (/:(8000|5173)\b/.test(url) && method !== "GET") {
    throw new Error(`V14 e2e attempted ${method} ${url} — live ports are forbidden.`);
  }
}

export function trackApi(page: Page) {
  const calls: ApiCall[] = [];
  page.on("request", (r) => {
    assertNotLiveStore(r);
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/") && !/:(8145|8000)\b/.test(u.host)) return;
    let body: unknown;
    try {
      body = r.postData() ? JSON.parse(r.postData()!) : undefined;
    } catch {
      body = r.postData();
    }
    calls.push({ method: r.method(), url: r.url(), path: u.pathname + u.search, body });
  });
  page.on("response", (res) => {
    const u = new URL(res.url());
    const c = [...calls]
      .reverse()
      .find((x) => x.path === u.pathname + u.search && x.method === res.request().method() && x.status === undefined);
    if (c) c.status = res.status();
  });
  return {
    calls,
    posts: (re: RegExp) => calls.filter((c) => c.method === "POST" && re.test(c.path)),
    mutations: () => calls.filter((c) => c.method !== "GET" && c.method !== "HEAD" && c.method !== "OPTIONS"),
    toLiveStore: () => calls.filter((c) => /:(8000|5173)\b/.test(c.url)),
    clear: () => {
      calls.length = 0;
    },
  };
}

export const uniq = (p: string) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

export const test = base.extend<{ net: ReturnType<typeof trackApi> }>({
  net: async ({ page }, use) => {
    await blockLiveStore(page);
    const net = trackApi(page);
    await use(net);
    const leaked = net.toLiveStore().filter((c) => c.method !== "GET");
    expect(leaked, leaked.map((c) => `${c.method} ${c.url}`).join("\n")).toEqual([]);
  },
});
export { expect };

export async function shot(page: Page, name: string) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

export async function openEditor(page: Page, query = "?tab=editor") {
  await page.goto(`/${query}`);
  await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("prompt-input")).toBeVisible({ timeout: 30_000 });
}

export async function apiCreateWorkspace(request: import("@playwright/test").APIRequestContext, name: string) {
  const r = await request.post(`${API}/api/v10/genome/workspaces`, { data: { name } });
  expect(r.ok(), `create workspace ${name}: ${r.status()}`).toBeTruthy();
  return (await r.json()) as {
    workspace_id: string;
    revision_counter: number;
    edit_count: number;
    active_genome_revision_id: string;
  };
}

export const tabButton = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
