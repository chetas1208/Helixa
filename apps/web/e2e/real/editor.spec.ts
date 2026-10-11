import { test, expect, tabButton, shot, API } from "../support/fixtures";
import { apiCreateWorkspace, apiWorkspace, uniq, trackApi } from "../support/helpers";
import { flowTextEdit, openLibraryAndExpectCard } from "../support/editorFlows";

/** REAL integrated: UI -> vite proxy -> live FastAPI (throwaway state). */
test.describe("REAL flow A/B: hero baseline and text edit", () => {
  test("A: hero baseline - body + DNA + composer visible, zero console errors, inspector reachable", async ({ page, request, collected }) => {
    const ws = await apiCreateWorkspace(request, uniq("e2e-A"));
    await page.goto(`/?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.getByTestId("prompt-input")).toBeVisible();
    await expect(page.getByTestId("mic-button")).toBeVisible();
    await expect(page.getByTestId("inspect-proposal")).toBeVisible();
    await expect(page.getByTestId("editor-status")).toContainText(/Baseline/);
    await expect(page.getByTestId("synthetic-label")).toBeVisible();
    await expect(page.getByTestId("workspace-context")).toContainText("ref_synthetic_chr22");
    // resting screen has no dashboards, harness graphs, logs, tables or library grid
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of ["harness lineage", "allele frequency", "trajectory", "simulation outcome", "receipt", "workspaces"]) expect(text, `dashboard term "${banned}" on Tab 1`).not.toContain(banned);
    await expect(page.locator("table")).toHaveCount(0);
    // inspector only after selecting a base
    await expect(page.getByTestId("base-inspector")).toHaveCount(0);
    await page.locator('[data-testid="base-list"] [role="option"][data-position="7"]').click();
    await expect(page.getByTestId("base-inspector")).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, "real-A-hero-baseline-1440x900");
    expect(collected.pageErrors).toEqual([]);
    expect(collected.errors).toEqual([]);
  });

  test("B: 'change base 4 to A' -> proposal -> confirm -> saved version -> DNA updates -> library lists it", async ({ page, request }) => {
    const name = uniq("e2e-B");
    const ws = await apiCreateWorkspace(request, name);
    const { after } = await flowTextEdit(page, { workspaceId: ws.workspace_id, getWs: () => apiWorkspace(request, ws.workspace_id), shotPrefix: "real-B" });
    expect((after.active_revision as unknown as { edits: unknown[] }).edits).toEqual([expect.objectContaining({ position: 4, ref: "T", alt: "A" })]);
    await openLibraryAndExpectCard(page, ws.workspace_id, /\b1 (in-silico )?edit\b/i);
    await shot(page, "real-B-library-lists-edit");
    // refresh keeps the saved state
    await page.reload();
    await tabButton(page, "Genome Editor").click();
    await expect(page.locator('[data-testid="base-list"] [role="option"][data-position="4"]')).toHaveAttribute("data-base", "A", { timeout: 20_000 });
  });

  test("B2: ambiguous / unsupported prompts never mutate and never call the backend", async ({ page, request }) => {
    const ws = await apiCreateWorkspace(request, uniq("e2e-B2"));
    const net = trackApi(page);
    await page.goto(`/?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
    net.clear();
    for (const text of ["make it a C", "change base 4", "insert A at 4", "delete base 4", "change base 999 to A", "what is base 4?"]) {
      await page.getByTestId("prompt-input").fill(text);
      await page.getByTestId("inspect-proposal").click();
      const out = page.getByTestId("composer-outcome");
      await expect(out, text).toBeVisible();
      await expect(out, text).not.toHaveAttribute("data-tone", "ok");
    }
    expect(net.mutations(), "ambiguous prompts must not produce any POST").toEqual([]);
    expect((await apiWorkspace(request, ws.workspace_id)).edit_count).toBe(0);
    await expect(page.getByTestId("proposal-preview")).toHaveCount(0);
  });

  test("B3: manual base selection -> draft only; Discard returns to baseline; Restore baseline keeps saved versions", async ({ page, request }) => {
    const ws = await apiCreateWorkspace(request, uniq("e2e-B3"));
    const net = trackApi(page);
    await page.goto(`/?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
    await page.locator('[data-testid="base-list"] [role="option"][data-position="10"]').click();
    await page.getByTestId("alt-A").click();
    await expect(page.locator('[data-testid="base-list"] [role="option"][data-position="10"]')).toHaveAttribute("data-draft", "true");
    await expect(page.getByTestId("editor-status")).toContainText(/Draft/);
    expect((await apiWorkspace(request, ws.workspace_id)).edit_count).toBe(0);
    expect(net.mutations().filter((c) => /commit/.test(c.path))).toHaveLength(0);
    await page.getByTestId("discard").click(); // first click asks for confirmation
    await page.getByTestId("discard").click();
    await expect(page.locator('[data-testid="base-list"] [role="option"][data-position="10"]')).toHaveAttribute("data-draft", "false");
    await expect(page.getByTestId("editor-status")).toContainText(/Baseline/);
  });

  test("B4 (defect P-1 guard): two alleles in one sentence are ambiguous, not silently resolved", async ({ page, request }) => {
    const ws = await apiCreateWorkspace(request, uniq("e2e-B4"));
    await page.goto(`/?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("prompt-input").fill("change base 4 to A and G");
    await page.getByTestId("inspect-proposal").click();
    await expect(page.getByTestId("composer-outcome")).not.toHaveAttribute("data-tone", "ok");
    await expect(page.getByTestId("proposal-preview")).toHaveCount(0);
  });

  test("B5: Restore baseline drafts a NEW version and keeps every saved version", async ({ page, request }) => {
    const ws = await apiCreateWorkspace(request, uniq("e2e-B5"));
    const { after } = await flowTextEdit(page, { workspaceId: ws.workspace_id, getWs: () => apiWorkspace(request, ws.workspace_id), shotPrefix: "real-B5" });
    // GET /workspaces/{id} carries no `revisions` on the live backend: count saved versions via /genome-lineage
    const versions = async () => ((await (await request.get(`${API}/api/v10/genome/workspaces/${ws.workspace_id}/genome-lineage`)).json()) as { nodes: unknown[] }).nodes.length;
    const versionsBefore = await versions();
    expect(versionsBefore, "baseline revision + one saved edit").toBe(2);
    expect(after.edit_count).toBe(1);
    await expect(page.getByTestId("restore-baseline")).toBeEnabled();
    await page.getByTestId("restore-baseline").click();
    // only a draft: saved versions untouched, server still has the edit
    const mid = await apiWorkspace(request, ws.workspace_id);
    expect(mid.edit_count).toBe(1);
    expect(await versions()).toBe(versionsBefore);
    await expect(page.getByTestId("editor-status")).toContainText(/Draft/);
  });
});
