import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { baseOption, selectBase, trackApi } from "./helpers";
import { shot, tabButton, TAB_NAMES } from "./fixtures";

/** Requests the app sends to discover optional routes; they target ids that cannot exist and change nothing. */
export const isProbe = (path: string) => /ws-capability-probe|\/api\/voice\/transcribe/.test(path);

export interface WsView { workspace_id: string; name: string; revision_counter: number; edit_count: number; active_revision: { preview_1_48: string } }

// ------------------------------------------------------------------------------------------------ voice (flow C)

export type VoiceScenario = { transcript?: string; partials?: string[]; error?: string; stepMs?: number };

/**
 * Injects a deterministic VoiceAdapter as window.__V12_VOICE_ADAPTER__ (the product's documented test hook) BEFORE
 * the app boots. Plain object, no imports, so it also works against the production bundle. No microphone is used.
 */
export async function installVoiceMock(page: Page, sc: VoiceScenario) {
  await page.addInitScript((s: VoiceScenario) => {
    const step = s.stepMs ?? 120;
    (window as unknown as Record<string, unknown>).__V12_VOICE_ADAPTER__ = {
      kind: "mock",
      isSupported: () => s.error !== "unsupported",
      start(h: { onStart?: () => void; onPartial: (t: string) => void; onFinal: (t: string) => void; onError: (c: string) => void; onEnd: () => void }) {
        const timers: ReturnType<typeof setTimeout>[] = [];
        let done = false;
        const at = (ms: number, fn: () => void) => timers.push(setTimeout(() => { if (!done) fn(); }, ms));
        const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); h.onEnd(); };
        let t = step;
        at(t, () => {
          if (s.error === "permission_denied" || s.error === "unsupported") { h.onError(s.error); finish(); return; }
          h.onStart?.();
        });
        if (s.error && s.error !== "permission_denied" && s.error !== "unsupported") at((t += step), () => { h.onError(s.error!); finish(); });
        else {
          for (const p of s.partials ?? []) at((t += step), () => h.onPartial(p));
          at((t += step), () => { if (s.transcript) h.onFinal(s.transcript); finish(); });
        }
        return { stop: () => { if (s.transcript) h.onFinal(s.transcript); finish(); }, cancel: () => { done = true; timers.forEach(clearTimeout); h.onEnd(); } };
      },
    };
  }, sc);
}

/** Flow C: mock transcript -> partial is display only -> editable review -> use -> proposal -> separate confirm. */
export async function flowVoice(page: Page, opts: { workspaceId: string; getWs: () => Promise<WsView>; shotPrefix: string }) {
  await installVoiceMock(page, { partials: ["change base", "change base 4 to"], transcript: "change base 4 to G", stepMs: 400 });
  const net = trackApi(page);
  await page.goto(`/?tab=editor&workspace=${opts.workspaceId}`);
  await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
  const before = await opts.getWs();
  await page.getByTestId("mic-button").click();
  const cap = page.getByTestId("voice-capture");
  await expect(cap).toHaveAttribute("data-adapter", "mock");
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect(page.getByTestId("voice-indicator")).toContainText(/Listening|Waiting/);
  await expect(page.getByTestId("voice-partial")).toContainText(/not used/, { timeout: 5_000 });
  expect(net.posts(/\/proposals$/), "a partial transcript never triggers anything").toHaveLength(0);
  await expect(cap).toHaveAttribute("data-phase", "review", { timeout: 10_000 });
  await expect(page.getByTestId("voice-transcript")).toHaveValue("change base 4 to G");
  // the user corrects the transcript before using it
  await page.getByTestId("voice-transcript").fill("change base 4 to C");
  expect(net.posts(/\/proposals$/), "nothing is sent before the transcript is confirmed").toHaveLength(0);
  await shot(page, `${opts.shotPrefix}-voice-review`);
  await page.getByTestId("voice-use").click();
  await expect(page.getByTestId("proposal-preview")).toBeVisible({ timeout: 20_000 });
  const props = net.posts(/\/proposals$/);
  expect(props).toHaveLength(1);
  expect(props[0]!.body).toMatchObject({ position: 4, alt: "C" });
  expect(net.posts(/\/commit$/), "using a transcript is not an edit confirmation").toHaveLength(0);
  const mid = await opts.getWs();
  expect(mid.edit_count).toBe(before.edit_count);
  await expect(baseOption(page, 4)).toHaveAttribute("data-draft", "true");
  await page.getByTestId("confirm-save").click();
  await expect(page.getByTestId("saved-notice")).toBeVisible({ timeout: 20_000 });
  expect(net.posts(/\/commit$/)).toHaveLength(1);
  const after = await opts.getWs();
  expect(after.edit_count).toBe(before.edit_count + 1);
  expect(after.active_revision.preview_1_48[3]).toBe("C");
  return net;
}

/** Voice failures: denied / unsupported / network / cancel never produce a request or an edit. */
export async function flowVoiceFailure(page: Page, workspaceId: string, sc: VoiceScenario & { expectCode?: string; cancel?: boolean }) {
  await installVoiceMock(page, sc);
  const net = trackApi(page);
  await page.goto(`/?tab=editor&workspace=${workspaceId}`);
  await expect(page.getByTestId("base-list")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mic-button").click();
  if (sc.error === "unsupported") {
    await expect(page.getByTestId("voice-capture")).toContainText("Voice transcription not configured");
    await expect(page.getByRole("button", { name: "Start listening" })).toHaveCount(0);
  } else {
    await page.getByRole("button", { name: "Start listening" }).click();
    if (sc.cancel) {
      await expect(page.getByTestId("voice-indicator")).toBeVisible();
      await page.getByTestId("voice-capture").getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByTestId("voice-capture")).toHaveAttribute("data-phase", "idle");
    } else {
      await expect(page.getByTestId("voice-error")).toHaveAttribute("data-code", sc.expectCode ?? sc.error!);
    }
  }
  await page.waitForTimeout(sc.cancel ? 3 * (sc.stepMs ?? 120) : 300); // a cancelled session must not deliver a late final transcript
  await expect(page.getByTestId("voice-transcript")).toHaveCount(0);
  await expect(page.getByTestId("prompt-input"), "text input always remains available").toBeEnabled();
  expect(net.mutations().filter((c) => !isProbe(c.path))).toEqual([]);
}

// ------------------------------------------------------------------------------------------------ cross-tab (flow F)

export const card = (page: Page, id: string) => page.getByTestId(`workspace-card-${id}`);

export async function activateInLibrary(page: Page, id: string, name: string) {
  if (!(await tabButton(page, "Harness Library").getAttribute("aria-selected"))?.includes("true")) await tabButton(page, "Harness Library").click();
  await expect(card(page, id)).toBeVisible({ timeout: 20_000 });
  await card(page, id).getByRole("button", { name: new RegExp(`^(Activate|Stay on|Open details of) ${escapeRe(name)}`) }).first().click();
}
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Asserts the whole shell agrees on the active workspace: card, top bar, URL, and Tab 1's DNA. */
export async function expectActiveEverywhere(page: Page, ws: { id: string; name: string; base5: string }) {
  await expect(card(page, ws.id)).toHaveAttribute("data-active", "true", { timeout: 20_000 });
  await expect(page.getByTestId("workspace-context")).toContainText(ws.name);
  await expect(page).toHaveURL(new RegExp(`workspace=${ws.id}`));
  await tabButton(page, "Genome Editor").click();
  await expect(baseOption(page, 5)).toHaveAttribute("data-base", ws.base5, { timeout: 20_000 });
  await expect(page.getByTestId("workspace-context")).toContainText(ws.name);
}

/**
 * Flow F: Library selection propagates to Tab 1 + shell; rapid A->B->A ends on A (UI and server); refresh and deep link
 * restore; unsaved-draft switch guard (Cancel keeps the draft, Discard switches, Save commits then switches).
 */
export async function flowCrossTab(
  page: Page,
  o: {
    a: { id: string; name: string; base5: string };
    b: { id: string; name: string; base5: string };
    serverActive: () => Promise<string | null>;
    editCount: (id: string) => Promise<number>;
    shotPrefix: string;
  },
) {
  const { a, b } = o;
  await page.goto(`/?tab=library&workspace=${a.id}`);
  await expect(card(page, a.id)).toHaveAttribute("data-active", "true", { timeout: 30_000 });

  // 1. selection propagates
  await activateInLibrary(page, b.id, b.name);
  await expectActiveEverywhere(page, b);
  await expect.poll(o.serverActive, { timeout: 10_000 }).toBe(b.id);
  for (const t of TAB_NAMES.slice(1, 3)) {
    await tabButton(page, t).click();
    await expect(page.getByTestId("workspace-context")).toContainText(b.name);
  }

  // 2. rapid A -> B -> A: the last intent wins in the UI and on the server
  await tabButton(page, "Harness Library").click();
  await activateInLibrary(page, a.id, a.name);
  await activateInLibrary(page, b.id, b.name).catch(() => undefined); // may be disabled while switching: that is fine
  await activateInLibrary(page, a.id, a.name).catch(() => undefined);
  await page.waitForTimeout(1500);
  await expect(card(page, a.id)).toHaveAttribute("data-active", "true", { timeout: 20_000 });
  await expect(card(page, b.id)).toHaveAttribute("data-active", "false");
  await expect.poll(o.serverActive, { timeout: 10_000 }).toBe(a.id);
  await expectActiveEverywhere(page, a);
  await shot(page, `${o.shotPrefix}-crosstab-after-ABA`);

  // 3. refresh restores tab + workspace; a deep link to B opens B on the requested tab
  await page.reload();
  await expect(tabButton(page, "Genome Editor")).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  await expect(baseOption(page, 5)).toHaveAttribute("data-base", a.base5, { timeout: 20_000 });
  await page.goto(`/?tab=evolution&workspace=${b.id}`);
  await expect(tabButton(page, "Genome & Harness Evolution")).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  await expect(page.getByTestId("workspace-context")).toContainText(b.name, { timeout: 20_000 });
  await tabButton(page, "Genome Editor").click();
  await expect(baseOption(page, 5)).toHaveAttribute("data-base", b.base5, { timeout: 20_000 });

  // 4. unsaved-draft switch guard on B
  const bEdits = await o.editCount(b.id);
  await selectBase(page, 10);
  const ref10 = await baseOption(page, 10).getAttribute("data-base");
  const alt10 = ref10 === "A" ? "C" : "A";
  await page.getByTestId(`alt-${alt10}`).click();
  await expect(baseOption(page, 10)).toHaveAttribute("data-draft", "true");
  await expect(page.getByTestId("draft-indicator")).toBeVisible();
  await activateInLibrary(page, a.id, a.name);
  const dlg = page.getByRole("dialog").or(page.getByRole("alertdialog"));
  await expect(dlg).toContainText(`Unsaved edits in ${b.name}`, { timeout: 10_000 });
  await shot(page, `${o.shotPrefix}-switch-guard`);
  await dlg.getByRole("button", { name: "Cancel switch" }).click();
  await expect(card(page, b.id)).toHaveAttribute("data-active", "true");
  await tabButton(page, "Genome Editor").click();
  await expect(baseOption(page, 10), "Cancel keeps the draft").toHaveAttribute("data-draft", "true");
  expect(await o.editCount(b.id)).toBe(bEdits);

  // Save draft, then switch: the draft is committed to B (its own workspace), then A becomes active
  await activateInLibrary(page, a.id, a.name);
  await dlg.getByRole("button", { name: "Save draft, then switch" }).click();
  await expect(card(page, a.id)).toHaveAttribute("data-active", "true", { timeout: 20_000 });
  await expect.poll(() => o.editCount(b.id), { timeout: 10_000 }).toBe(bEdits + 1);
  expect(await o.editCount(a.id), "nothing was written to the target workspace").toBe(0);

  // Discard draft and switch: nothing is written anywhere
  await tabButton(page, "Genome Editor").click();
  await selectBase(page, 12);
  const ref12 = await baseOption(page, 12).getAttribute("data-base");
  await page.getByTestId(`alt-${ref12 === "G" ? "T" : "G"}`).click();
  await expect(baseOption(page, 12)).toHaveAttribute("data-draft", "true");
  await activateInLibrary(page, b.id, b.name);
  await dlg.getByRole("button", { name: "Discard draft and switch" }).click();
  await expect(card(page, b.id)).toHaveAttribute("data-active", "true", { timeout: 20_000 });
  expect(await o.editCount(a.id)).toBe(0);
  expect(await o.editCount(b.id)).toBe(bEdits + 1);
  await activateInLibrary(page, a.id, a.name);
  await tabButton(page, "Genome Editor").click();
  await expect(baseOption(page, 12), "discarded draft is gone").toHaveAttribute("data-draft", "false", { timeout: 20_000 });
}

// ------------------------------------------------------------------------------------------------ simulation (flow E)

/** Opens the Outcome panel's "Run record" and asserts the run on screen IS the given run (id, workspace, revision, hash). */
export async function expectRunRecord(page: Page, sim: { simulation_id: string; workspace_id: string; genome_revision_id: string; result_sha256: string }) {
  const toggle = page.getByRole("button", { name: /Run record/ });
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const rec = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);
  for (const v of [sim.simulation_id, sim.workspace_id, sim.genome_revision_id, sim.result_sha256]) await expect(rec).toContainText(v);
}
