import { test, expect, apiCreateWorkspace, uniq, shot, tabButton, API } from "./support";

test.describe("V14 cross-tab", () => {
  test("save revision → library lists it → editor restores the allele", async ({ page, request, net }) => {
    void net;
    const name = uniq("v14-xtab");
    const ws = await apiCreateWorkspace(request, name);
    await page.goto(`/?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("prompt-input").fill("change base 4 to A");
    await page.getByTestId("inspect-proposal").click();
    await expect(page.getByTestId("proposal-preview")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("confirm-save").click();
    await expect(page.getByTestId("saved-notice")).toBeVisible({ timeout: 20_000 });
    await tabButton(page, "Harness Library").click();
    const card = page.getByTestId(`workspace-card-${ws.workspace_id}`);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(/1 (in-silico )?edit|revision/i);
    await tabButton(page, "Genome Editor").click();
    await expect(page.locator('[data-testid="base-list"] [role="option"][data-position="4"]')).toHaveAttribute(
      "data-base",
      "A",
      { timeout: 20_000 },
    );
    await page.reload();
    await tabButton(page, "Genome Editor").click();
    await expect(page.locator('[data-testid="base-list"] [role="option"][data-position="4"]')).toHaveAttribute(
      "data-base",
      "A",
      { timeout: 20_000 },
    );
    await shot(page, "crosstab-restored");
  });

  test("evolution genome lineage is not harness lineage", async ({ page, request, net }) => {
    void net;
    const ws = await apiCreateWorkspace(request, uniq("v14-evo"));
    const genome = await request.get(`${API}/api/v10/genome/workspaces/${ws.workspace_id}/genome-lineage`);
    const harness = await request.get(`${API}/api/v10/genome/workspaces/${ws.workspace_id}/harness-lineage`);
    expect(genome.ok()).toBeTruthy();
    expect(harness.ok()).toBeTruthy();
    const g = await genome.json();
    const h = await harness.json();
    expect(g.kind).toBe("GENOME_REVISION");
    expect(h.kind).toBe("ANALYSIS_HARNESS");
    expect(h.distinct_from_genome).toBe(true);
    const gids = new Set((g.nodes ?? []).map((n: { genome_revision_id: string }) => n.genome_revision_id));
    const hids = new Set((h.nodes ?? []).map((n: { harness_version_id: string }) => n.harness_version_id));
    for (const id of gids) expect(hids.has(id), `genome id ${id} leaked into harness lineage`).toBeFalsy();

    await page.goto(`/?tab=evolution&workspace=${ws.workspace_id}`);
    await expect(tabButton(page, "Genome & Harness Evolution")).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toMatch(/harness version is a genome revision/);
    await shot(page, "crosstab-lineage");
  });
});
