import { test, expect, openEditor, apiCreateWorkspace, uniq, shot, API, tabButton } from "./support";

const REQUIRED_PARTS = ["head", "hand", "heart", "kidney", "foot", "spine"] as const;

test.describe("V14 scientific UX", () => {
  test("head/hand/heart/kidney/foot/spine are selectable or searchable", async ({ page, request, net }) => {
    void net;
    const ws = await apiCreateWorkspace(request, uniq("v14-organs"));
    await openEditor(page, `?tab=editor&workspace=${ws.workspace_id}`);
    const explore = page.getByTestId("explore-body-parts").or(page.getByRole("button", { name: /Explore body parts/i }));
    await expect(explore.first()).toBeVisible({ timeout: 20_000 });
    await explore.first().click();
    const search = page.locator("#anatomy-search").or(page.getByRole("searchbox", { name: /Search anatomy/i }));
    try {
      await expect(search.first()).toBeVisible({ timeout: 10_000 });
    } catch {
      throw new Error(
        "V14 Agent 3 has not shown AnatomyTree search after Explore body parts. " +
          "head/hand/heart/kidney/foot/spine must be selectable or searchable.",
      );
    }
    const missing: string[] = [];
    for (const part of REQUIRED_PARTS) {
      await search.first().fill(part);
      const hit = page.getByRole("list", { name: "Search results" }).getByRole("button").filter({ hasText: new RegExp(part, "i") });
      const treeHit = page.getByRole("treeitem").filter({ hasText: new RegExp(part, "i") });
      try {
        await expect.poll(async () => (await hit.count()) > 0 || (await treeHit.count()) > 0, { timeout: 3_000 }).toBe(true);
      } catch {
        /* let the check below record missing */
      }
      const found = (await hit.count()) > 0 || (await treeHit.count()) > 0;
      if (!found) missing.push(part);
    }
    expect(missing, `Agent 1/3 have not made these parts selectable or searchable: ${missing.join(", ")}`).toEqual([]);
    await shot(page, "science-required-parts");
  });

  test("expression panel shows caveat + observed-expression tier, never genes that control", async ({ page, request, net }) => {
    void net;
    const tree = await request.get(`${API}/api/anatomy/tree`);
    if (!tree.ok()) {
      throw new Error(`V14 Agent 2 has not landed GET /api/anatomy/tree (HTTP ${tree.status()}).`);
    }
    const heart = (await tree.json()).nodes.find(
      (n: { ontology_id?: string; label?: string }) => n.ontology_id === "UBERON:0000948" || /heart/i.test(n.label ?? ""),
    );
    if (!heart) throw new Error("V14 Agent 2 tree has no heart node.");
    const panel = await request.get(`${API}/api/anatomy/${heart.id}/genes`);
    if (!panel.ok()) {
      throw new Error(`V14 Agent 2 has not landed GET /api/anatomy/{id}/genes (HTTP ${panel.status()}).`);
    }
    const rows = ((await panel.json()).items ?? []) as { caveat?: string }[];
    if (!rows.length) {
      throw new Error(
        "V14 Agent 2 heart gene panel is empty (no cached tissue-expression). " +
          "Caveat + observed-expression tier cannot appear until expression rows exist.",
      );
    }
    const ws = await apiCreateWorkspace(request, uniq("v14-expr"));
    await openEditor(page, `?tab=editor&workspace=${ws.workspace_id}&anatomy=${encodeURIComponent(heart.id)}`);
    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    expect(bodyText).not.toContain("genes that control");
    await expect(page.getByText(/Expression shows the gene is active/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Observed tissue expression/i).first()).toBeVisible();
    await shot(page, "science-expression-caveat");
  });

  test("make my hands bigger is a trait goal, not a mutation", async ({ page, request, net }) => {
    const ws = await apiCreateWorkspace(request, uniq("v14-hands"));
    await openEditor(page, `?tab=editor&workspace=${ws.workspace_id}`);
    const input = page.getByTestId("prompt-input");
    await expect(input).toBeVisible({ timeout: 30_000 });
    net.clear();
    await input.fill("make my hands bigger");
    await page.getByTestId("inspect-proposal").click();
    const outcome = page.getByTestId("composer-outcome").or(page.getByText(/trait|not automatic|cannot automatically/i));
    await expect(outcome).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("proposal-preview")).toHaveCount(0);
    const proposals = net.posts(/\/genome-edit\/proposals$/);
    expect(proposals, "trait goal must not POST a proposal").toEqual([]);
    const interpret = net.posts(/\/interpret-command$/);
    if (interpret.length) {
      expect((interpret[0]!.body as { text?: string }).text).toMatch(/hands bigger/);
    }
    const after = await request.get(`${API}/api/v10/genome/workspaces/${ws.workspace_id}`);
    expect((await after.json()).edit_count).toBe(0);
    await shot(page, "science-trait-goal-hands");
  });

  test("3D DNA allele updates after a precise edit; body geometry does not claim an organ effect", async ({ page, request, net }) => {
    void net;
    const ws = await apiCreateWorkspace(request, uniq("v14-dna"));
    await openEditor(page, `?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
    const bodyBefore = await request.get(`${API}/api/v10/genome/workspaces/${ws.workspace_id}/body-descriptor`);
    expect(bodyBefore.ok()).toBeTruthy();
    expect((await bodyBefore.json()).anatomy_changed).toBe(false);

    await page.getByTestId("prompt-input").fill("change base 4 to A");
    await page.getByTestId("inspect-proposal").click();
    const preview = page.getByTestId("proposal-preview");
    if (await preview.count()) {
      await expect(page.locator('[data-testid="base-list"] [role="option"][data-position="4"]')).toHaveAttribute("data-base", "A");
      await page.getByTestId("confirm-save").click();
      await expect(page.getByTestId("saved-notice")).toBeVisible({ timeout: 20_000 });
    }
    const bodyAfter = await request.get(`${API}/api/v10/genome/workspaces/${ws.workspace_id}/body-descriptor`);
    expect((await bodyAfter.json()).anatomy_changed).toBe(false);
    const honesty = page.getByTestId("body-caption").or(page.getByTestId("no-body-effect"));
    await expect(honesty.first()).toBeVisible();
    await expect(page.getByText(/No validated body-level effect/i).first()).toBeVisible();
    await shot(page, "science-dna-not-body");
  });

  test("GWAS panel cites Catalog v2 study context when the gene is opened", async ({ page, request, net }) => {
    void net;
    const variants = await request.get(`${API}/api/genes/ENSG00000092054/variants?assembly=GRCh38`);
    if (!variants.ok()) {
      throw new Error(`V14 Agent 2 has not landed GET /api/genes/{id}/variants (HTTP ${variants.status()}).`);
    }
    const payload = await variants.json();
    expect(payload.source).toBe("GWAS Catalog REST API v2");
    const ws = await apiCreateWorkspace(request, uniq("v14-gwas"));
    await openEditor(page, `?tab=editor&workspace=${ws.workspace_id}&gene=ENSG00000092054`);
    if ((payload.associations ?? []).length) {
      await expect(page.getByText(/GWAS Catalog REST API v2/i)).toBeVisible({ timeout: 20_000 });
      const text = (await page.locator("body").innerText()).toLowerCase();
      expect(text).toMatch(/gwas|association|pubmed|study/);
      expect(text).not.toContain("genes that control");
    }
    await shot(page, "science-gwas-v2");
  });
});

test.describe("V14 simulation honesty", () => {
  test("unsupported phenotype is labelled not modeled", async ({ page, request, net }) => {
    void net;
    const ws = await apiCreateWorkspace(request, uniq("v14-sim"));
    await page.goto(`/?tab=simulation&workspace=${ws.workspace_id}`);
    await expect(tabButton(page, "Earth Evolution Sandbox")).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    await expect(page.getByText(/not modeled/i).first()).toBeVisible({ timeout: 30_000 });
    const text = (await page.locator("body").innerText()).toLowerCase();
    const honest =
      text.includes("not modeled") ||
      text.includes("not modelled") ||
      text.includes("not supported") ||
      text.includes("illustrative");
    if (!text.includes("not modeled") && !text.includes("not modelled")) {
      throw new Error(
        "V14 Agent 4 / V12 simulation has not labelled an unsupported phenotype `not modeled`. " +
          `Visible honesty markers present=${honest}.`,
      );
    }
    await shot(page, "science-sim-not-modeled");
  });
});
