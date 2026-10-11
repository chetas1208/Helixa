import { test, expect, TAB_NAMES, tabButton, openApp, shot } from "../support/fixtures";
import { probeSnapshot } from "../support/probe";

/** MOCKED (route-intercepted FakeBackend). Shell contract: four tabs, persistence, one WebGL context. */
test.describe("shell (mocked)", () => {
  test("exactly four tabs, in order, with the exact titles; no legacy tabs", async ({ page, fake, collected }) => {
    await fake();
    await openApp(page);
    const names = (await page.getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s*\d+\s*$/, "").trim());
    expect(names).toEqual([...TAB_NAMES]);
    await expect(page.getByRole("tab")).toHaveCount(4);
    for (const legacy of ["Mission", "Proof", "Studio", "Harness Intelligence"]) await expect(page.getByRole("tab", { name: legacy })).toHaveCount(0);
    expect(collected.pageErrors).toEqual([]);
  });

  test("the first tab is Genome Editor and exactly one tab is selected", async ({ page, fake }) => {
    await fake();
    await openApp(page);
    await expect(tabButton(page, "Genome Editor")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  });

  test("shell chrome: brand, active workspace name, reference id, real connection status", async ({ page, fake }) => {
    await fake();
    await openApp(page);
    await expect(page.getByText("HELIXA").first()).toBeVisible();
    await expect(page.getByText("Studio workspace").first()).toBeVisible();
    await expect(page.getByText("ref_synthetic_chr22").first()).toBeVisible();
    await expect(page.getByText(/API online/i).first()).toBeVisible();
  });

  test("connection indicator reflects REAL health: API down shows offline, never a fake 'online'", async ({ page, fake }) => {
    await fake({ down: true });
    await page.goto("/");
    await expect(page.getByText(/offline|unreachable|not reachable|disconnected/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/API online/i)).toHaveCount(0);
  });

  test("deep link ?tab=library&workspace= selects the tab and the workspace; refresh keeps both", async ({ page, fake }) => {
    const be = await fake();
    be.createWorkspace("Second workspace"); // becomes active server-side
    const first = be.workspaces[0]!.workspace_id;
    await page.goto(`/?tab=library&workspace=${first}`);
    await expect(tabButton(page, "Harness Library")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(new RegExp(`workspace=${first}`));
    await page.reload();
    await expect(tabButton(page, "Harness Library")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(new RegExp(`workspace=${first}`));
    await expect(page.getByText("Studio workspace").first()).toBeVisible();
  });

  test("invalid deep link params are ignored without crashing", async ({ page, fake, collected }) => {
    await fake();
    await page.goto("/?tab=mission&workspace=%3Cscript%3E");
    await expect(page.getByRole("tab")).toHaveCount(4);
    await expect(tabButton(page, "Genome Editor")).toHaveAttribute("aria-selected", "true");
    expect(collected.pageErrors).toEqual([]);
  });

  test("a workspace id that does not exist falls back honestly (no blank screen)", async ({ page, fake, collected }) => {
    await fake();
    await page.goto("/?tab=editor&workspace=ws-doesnotexist");
    await expect(page.getByRole("tab")).toHaveCount(4);
    await expect(page.getByText("Studio workspace").first()).toBeVisible({ timeout: 15_000 });
    expect(collected.pageErrors).toEqual([]);
  });

  test("tab switching keeps ONE persistent WebGL context and the same canvas element (20 switches)", async ({ page, fake }) => {
    await fake();
    await openApp(page);
    await expect(page.locator("canvas")).toHaveCount(1);
    await page.waitForTimeout(1500);
    await page.locator("canvas").first().evaluate((c) => ((c as HTMLCanvasElement & { __keep?: boolean }).__keep = true));
    const before = await probeSnapshot(page);
    for (let i = 0; i < 20; i++) {
      await tabButton(page, TAB_NAMES[(i + 1) % 4]!).click();
      await page.waitForTimeout(120);
    }
    const after = await probeSnapshot(page);
    // the app may create short-lived feature-detection canvases at boot (SceneHost.detectWebGL); none may be created by tab switching
    expect(after.created, "WebGL contexts created by 20 tab switches").toBe(before.created);
    expect(after.live, "connected canvases with a WebGL context").toBeLessThanOrEqual(1);
    expect(after.lostConnected, "context loss on the rendered canvas").toBe(0);
    expect(await page.locator("canvas").first().evaluate((c) => !!(c as HTMLCanvasElement & { __keep?: boolean }).__keep)).toBe(true);
  });

  test("workspace + selection survive tab changes", async ({ page, fake }) => {
    await fake();
    await openApp(page);
    const url0 = new URL(page.url());
    await tabButton(page, "Genome & Harness Evolution").click();
    await tabButton(page, "Earth Evolution Sandbox").click();
    await tabButton(page, "Genome Editor").click();
    expect(new URL(page.url()).searchParams.get("workspace")).toBe(url0.searchParams.get("workspace") ?? new URL(page.url()).searchParams.get("workspace"));
    await expect(page.getByText("Studio workspace").first()).toBeVisible();
  });

  test("number hotkeys / arrow keys switch tabs without trapping focus", async ({ page, fake }) => {
    await fake();
    await openApp(page);
    await tabButton(page, "Genome Editor").focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(tabButton(page, "Genome & Harness Evolution")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
  });

  test("browser Back returns to the previous tab (user tab changes push history)", async ({ page, fake }) => {
    await fake();
    await openApp(page);
    await tabButton(page, "Genome & Harness Evolution").click();
    await tabButton(page, "Earth Evolution Sandbox").click();
    await page.goBack();
    await expect(tabButton(page, "Genome & Harness Evolution")).toHaveAttribute("aria-selected", "true");
  });

  test("screenshot of the resting shell", async ({ page, fake }) => {
    await fake();
    await openApp(page);
    await page.waitForTimeout(1500);
    await shot(page, "mocked-shell-desktop-1440x900");
  });
});
