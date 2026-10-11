import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { baseOption, selectBase, submitPrompt, trackApi } from "./helpers";
import { shot, tabButton } from "./fixtures";

/** Flow B body shared by the MOCKED and REAL projects. `getWs` returns the authoritative server view. */
export async function flowTextEdit(page: Page, opts: { workspaceId: string; getWs: () => Promise<{ revision_counter: number; edit_count: number; active_revision: { preview_1_48: string } }>; shotPrefix: string }) {
  const net = trackApi(page);
  await page.goto(`/?tab=editor&workspace=${opts.workspaceId}`);
  await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("editor-status")).toContainText(/Baseline/i);
  const before = await opts.getWs();
  expect(before.edit_count).toBe(0);

  // select base 4: coordinate + reference + complement
  await selectBase(page, 4);
  await expect(page.getByTestId("base-inspector")).toBeVisible();
  const insp = page.getByTestId("base-inspector");
  await expect(page.getByTestId("inspector-coordinate")).toHaveText("chr22:4");
  await expect(insp).toContainText(/Reference \(observed\)\s*T\s*pairs with\s*A/); // reference at position 4 + its Watson-Crick complement

  // text prompt -> proposal, NOT committed
  await submitPrompt(page, "change base 4 to A");
  await expect(page.getByTestId("composer-outcome")).toBeVisible();
  await expect(page.getByTestId("proposal-preview")).toBeVisible();
  const row = page.getByTestId("proposal-row").first();
  await expect(row).toContainText("4");
  await expect(row).toContainText(/T\s*A|T to A/);
  await expect(row).toContainText(/Ready to review/i, { timeout: 20_000 });
  await expect(page.getByTestId("parsed-locally")).toBeVisible();
  // draft preview updates immediately; authoritative state unchanged
  await expect(baseOption(page, 4)).toHaveAttribute("data-base", "A");
  await expect(baseOption(page, 4)).toHaveAttribute("data-draft", "true");
  const mid = await opts.getWs();
  expect(mid.edit_count, "nothing may be saved before the user confirms").toBe(0);
  expect(mid.revision_counter).toBe(before.revision_counter);
  expect(net.posts(/\/commit$/), "no commit request before confirmation").toHaveLength(0);
  const prop = net.posts(/\/proposals$/);
  expect(prop.length).toBeGreaterThanOrEqual(1);
  expect(prop[0]!.path).toBe(`/api/v10/genome/workspaces/${opts.workspaceId}/proposals`);
  expect(prop[0]!.body).toMatchObject({ position: 4, alt: "A" });
  await shot(page, `${opts.shotPrefix}-editor-proposal-review`);

  // confirm -> version saved
  await page.getByTestId("confirm-save").click();
  await expect(page.getByTestId("saved-notice")).toBeVisible({ timeout: 20_000 });
  const commits = net.posts(/\/commit$/);
  expect(commits).toHaveLength(1);
  expect(commits[0]!.path).toBe(`/api/v10/genome/workspaces/${opts.workspaceId}/commit`);
  expect(commits[0]!.body).toMatchObject({ expected_counter: before.revision_counter });
  expect(commits[0]!.status).toBe(200);
  const after = await opts.getWs();
  expect(after.edit_count).toBe(1);
  expect(after.revision_counter).toBe(before.revision_counter + 1);
  expect(after.active_revision.preview_1_48[3]).toBe("A");
  // DNA preview now reflects the SAVED state, draft cleared
  await expect(baseOption(page, 4)).toHaveAttribute("data-base", "A");
  await expect(baseOption(page, 4)).toHaveAttribute("data-draft", "false");
  await expect(page.getByTestId("editor-status")).toContainText(/Validated/i);
  await shot(page, `${opts.shotPrefix}-editor-saved`);
  return { net, before, after };
}

export async function openLibraryAndExpectCard(page: Page, workspaceId: string, expectText: RegExp) {
  await tabButton(page, "Harness Library").click();
  const card = page.getByTestId(`workspace-card-${workspaceId}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(expectText);
  return card;
}

export type Req = APIRequestContext;
