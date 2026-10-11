import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { API, tabButton, TAB_NAMES } from "./fixtures";

export interface ApiCall { method: string; path: string; body: unknown; status?: number; headers: Record<string, string> }

/** Records every same-origin /api request (with body + status) made by the page. */
export function trackApi(page: Page) {
  const calls: ApiCall[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/")) return;
    let body: unknown;
    try { body = r.postData() ? JSON.parse(r.postData()!) : undefined; } catch { body = r.postData(); }
    calls.push({ method: r.method(), path: u.pathname + u.search, body, headers: r.headers() });
  });
  page.on("response", (res) => {
    const u = new URL(res.url());
    const c = [...calls].reverse().find((x) => x.path === u.pathname + u.search && x.method === res.request().method() && x.status === undefined);
    if (c) c.status = res.status();
  });
  return {
    calls,
    posts: (re: RegExp) => calls.filter((c) => c.method === "POST" && re.test(c.path)),
    mutations: () => calls.filter((c) => c.method !== "GET"),
    clear: () => (calls.length = 0),
  };
}

export const uniq = (p: string) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

/** REAL backend helpers (direct HTTP, no Origin header: the API only checks Origin when present). */
export async function apiCreateWorkspace(request: APIRequestContext, name: string) {
  const r = await request.post(`${API}/api/v10/genome/workspaces`, { data: { name } });
  expect(r.ok(), `create workspace ${name}: ${r.status()}`).toBeTruthy();
  return (await r.json()) as { workspace_id: string; revision_counter: number; edit_count: number; active_genome_revision_id: string };
}
export async function apiWorkspace(request: APIRequestContext, id: string) {
  const r = await request.get(`${API}/api/v10/genome/workspaces/${id}`);
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { workspace_id: string; name: string; revision_counter: number; edit_count: number; active_revision: { preview_1_48: string; edits: { position: number; ref: string; alt: string }[]; sequence_sha256: string }; revisions?: unknown[] };
}
export async function apiActive(request: APIRequestContext) {
  const r = await request.get(`${API}/api/v10/genome/workspaces/active`);
  return r.ok() ? ((await r.json()) as { workspace_id: string }) : null;
}

export const gotoTab = async (page: Page, name: (typeof TAB_NAMES)[number]) => { await tabButton(page, name).click(); };

/** Select a base through the semantic listbox (the DOM mirror of the helix). */
export async function selectBase(page: Page, position: number) {
  await page.locator(`[data-testid="base-list"] [role="option"][data-position="${position}"]`).click();
  await expect(page.locator(`[data-testid="base-list"] [role="option"][data-position="${position}"]`)).toHaveAttribute("aria-selected", "true");
}

export async function submitPrompt(page: Page, text: string) {
  await page.getByTestId("prompt-input").fill(text);
  await page.getByTestId("inspect-proposal").click();
}

export const baseOption = (page: Page, position: number) => page.locator(`[data-testid="base-list"] [role="option"][data-position="${position}"]`);
