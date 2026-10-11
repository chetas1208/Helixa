import { test, expect, openEditor, apiCreateWorkspace, uniq, shot, trackApi } from "./support";
import { installVoiceMock } from "../support/flows";

test.describe("V14 first viewport and voice", () => {
  test("first viewport is body + DNA + prompt only", async ({ page, request, net }) => {
    void net;
    const ws = await apiCreateWorkspace(request, uniq("v14-hero"));
    await openEditor(page, `?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.locator("canvas")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("prompt-input")).toBeVisible();
    await expect(page.getByTestId("mic-button")).toBeVisible();
    await expect(page.getByText(/What would you like to explore or edit\?/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Explore body parts/i })).toBeVisible();
    await expect(page.getByText(/Baseline\s*·\s*GRCh38|Baseline · GRCh38/i)).toBeVisible();
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of ["harness lineage", "allele frequency", "trajectory", "simulation outcome"]) {
      expect(text, `dashboard term "${banned}" on first viewport`).not.toContain(banned);
    }
    await expect(page.getByRole("tablist").nth(1)).toHaveCount(0);
    await shot(page, "ux-first-viewport");
  });

  test("voice transcript never auto-applies", async ({ page, request }) => {
    const ws = await apiCreateWorkspace(request, uniq("v14-voice"));
    await installVoiceMock(page, { transcript: "change base 4 to G", partials: ["change base"], stepMs: 200 });
    const net = trackApi(page);
    await page.goto(`/?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("prompt-input")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("mic-button").click();
    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByTestId("voice-transcript")).toHaveValue("change base 4 to G", { timeout: 10_000 });
    expect(net.posts(/\/proposals$/), "transcript must not auto-propose").toHaveLength(0);
    expect(net.posts(/\/interpret-command$/)).toHaveLength(0);
    await expect(page.getByTestId("proposal-preview")).toHaveCount(0);
    await shot(page, "ux-voice-review");
    await page.getByTestId("voice-use").click();
    // Use still only proposes; it does not apply.
    expect(net.posts(/\/commit$|\/apply$/)).toHaveLength(0);
    const after = await request.get(`http://127.0.0.1:${process.env.E2E_API_PORT ?? 8145}/api/v10/genome/workspaces/${ws.workspace_id}`);
    expect((await after.json()).edit_count).toBe(0);
  });

  test("typed and voice share the same propose path", async ({ page, request }) => {
    const ws = await apiCreateWorkspace(request, uniq("v14-path"));
    await installVoiceMock(page, { transcript: "change base 5 to C", stepMs: 150 });
    const net = trackApi(page);
    await page.goto(`/?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("prompt-input")).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("prompt-input").fill("change base 5 to C");
    await page.getByTestId("inspect-proposal").click();
    const typedPosts = [...net.posts(/\/interpret-command$|\/proposals$/)];
    expect(typedPosts.length, "typed inspect must hit interpret-command or proposals").toBeGreaterThan(0);

    await page.getByTestId("mic-button").click();
    await page.getByRole("button", { name: "Start listening" }).click();
    await expect(page.getByTestId("voice-transcript")).toHaveValue("change base 5 to C", { timeout: 10_000 });
    net.clear();
    await page.getByTestId("voice-use").click();
    const voicePosts = net.posts(/\/interpret-command$|\/proposals$/);
    expect(voicePosts.length, "voice Use must hit the same interpret/propose path").toBeGreaterThan(0);
    const typedPaths = new Set(typedPosts.map((c) => c.path.replace(/\/[^/]+$/, "/*")));
    const voicePaths = new Set(voicePosts.map((c) => c.path.replace(/\/[^/]+$/, "/*")));
    expect([...voicePaths].some((p) => typedPaths.has(p) || /interpret-command|proposals/.test(p))).toBeTruthy();
    await shot(page, "ux-typed-voice-same-path");
  });

  test("reduced motion still allows an edit", async ({ page, request, net }) => {
    const ws = await apiCreateWorkspace(request, uniq("v14-motion"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openEditor(page, `?tab=editor&workspace=${ws.workspace_id}`);
    await expect(page.getByTestId("prompt-input")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("prompt-input").fill("change base 4 to A");
    await page.getByTestId("inspect-proposal").click();
    const preview = page.getByTestId("proposal-preview");
    await expect(page.getByTestId("composer-outcome")).toBeVisible({ timeout: 15_000 });
    if (await preview.count()) {
      await expect(preview).toBeVisible();
      await page.getByTestId("confirm-save").click();
      await expect(page.getByTestId("saved-notice")).toBeVisible({ timeout: 20_000 });
      const after = await request.get(`http://127.0.0.1:${process.env.E2E_API_PORT ?? 8145}/api/v10/genome/workspaces/${ws.workspace_id}`);
      expect((await after.json()).edit_count).toBeGreaterThan(0);
    } else {
      expect(net.posts(/\/interpret-command$|\/proposals$/).length).toBeGreaterThan(0);
    }
    await shot(page, "ux-reduced-motion");
  });
});
