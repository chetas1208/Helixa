import { test, expect, shot } from "../support/fixtures";
import { flowTextEdit } from "../support/editorFlows";
import { expectRunRecord, flowCrossTab, flowVoice, flowVoiceFailure, type WsView } from "../support/flows";
import { baseOption, selectBase, submitPrompt, trackApi } from "../support/helpers";
import { FakeBackend } from "../../tests/support/fakeBackend";
import { subjectsLit } from "../support/scenePixels";

/**
 * MOCKED contract flows (route-intercepted FakeBackend; no live API). A pass here proves the UI honours the
 * observed contract, NOT that it works against the real service: the REAL project repeats the key flows.
 */
const V = "/api/v10/genome/workspaces";
function commitFake(be: FakeBackend, id: string, pos: number, alt: string) {
  const p = be.handle("POST", `${V}/${id}/proposals`, { position: pos, alt }).json as { proposal_id: string };
  be.handle("POST", `${V}/${id}/commit`, { proposal_id: p.proposal_id, expected_counter: be.ws(id)!.revision_counter });
}
const view = (be: FakeBackend, id: string) => async () => be.handle("GET", `${V}/${id}`).json as WsView;
const VIEWPORTS = [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]] as const;

test.describe("MOCKED flow A: Genome Editor hero (no sub-tabs, body + DNA always visible)", () => {
  for (const [w, h] of VIEWPORTS) {
    test(`A @ ${w}x${h}: body + helix + composer, no tablist inside the tab, semantic DOM mirror`, async ({ page, fake, collected }) => {
      await page.setViewportSize({ width: w, height: h });
      await fake();
      await page.goto("/?tab=editor");
      const tab = page.getByTestId("genome-editor-tab");
      await expect(page.getByTestId("base-list")).toBeAttached({ timeout: 30_000 });
      await expect(page.locator("canvas")).toHaveCount(1);
      await expect(page.getByTestId("prompt-input")).toBeVisible();
      await expect(page.getByTestId("mic-button")).toBeVisible();
      await expect(page.getByTestId("inspect-proposal")).toBeVisible();
      // user directive: no tabs/sub-tabs inside the Genome Editor at any width
      await expect(tab.getByRole("tablist")).toHaveCount(0);
      await expect(tab.getByRole("tab")).toHaveCount(0);
      await expect(tab.getByTestId("mobile-view-toggle")).toHaveCount(0);
      await expect(tab.getByRole("radiogroup", { name: /Body figure view|^Show$/ })).toHaveCount(0);
      await expect(page.getByRole("tablist"), "only the app's own tab strip").toHaveCount(1);
      // semantic mirror of the helix: 48 options, keyboard operable
      await expect(page.locator('[data-testid="base-list"] [role="option"]')).toHaveCount(48);
      await page.waitForTimeout(1500);
      const lit = await subjectsLit(page, `mocked-A-scene-only-${w}x${h}`);
      expect.soft(lit.body, `body column has lit geometry (${JSON.stringify(lit)})`).toBeGreaterThan(0.004);
      expect.soft(lit.helix, `helix column has lit geometry (${JSON.stringify(lit)})`).toBeGreaterThan(0.004);
      await shot(page, `mocked-A-hero-${w}x${h}`);
      expect(collected.pageErrors).toEqual([]);
    });
  }

  test("A: resting screen has no dashboards/logs/tables; inspector appears only after selection", async ({ page, fake }) => {
    await fake();
    await page.goto("/?tab=editor");
    await expect(page.getByTestId("base-list")).toBeAttached({ timeout: 30_000 });
    const text = (await page.getByTestId("genome-editor-tab").innerText()).toLowerCase();
    for (const banned of ["harness lineage", "allele frequency", "trajectory", "simulation outcome", "receipt"]) expect(text).not.toContain(banned);
    await expect(page.locator("table")).toHaveCount(0);
    await expect(page.getByTestId("base-inspector")).toHaveCount(0);
    await selectBase(page, 4);
    await expect(page.getByTestId("inspector-coordinate")).toHaveText("chr22:4");
    await expect(page.getByTestId("base-inspector")).toContainText(/T\s*pairs with\s*A/);
  });

  test("A: keyboard on the DNA mirror: arrows move the selection, typing a letter drafts (never commits)", async ({ page, fake }) => {
    const be = await fake();
    const net = trackApi(page);
    await page.goto("/?tab=editor");
    await selectBase(page, 4);
    await baseOption(page, 4).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("inspector-coordinate")).toHaveText("chr22:5", { timeout: 5_000 });
    await page.keyboard.press("t");
    await expect(baseOption(page, 5)).toHaveAttribute("data-draft", "true");
    expect(net.posts(/\/commit$/)).toHaveLength(0);
    expect(be.ws(be.workspaces[0]!.workspace_id)!.edit_count).toBe(0);
  });

  test("A: DNA draft renders instantly; the body descriptor stays anatomy_changed=false and the caption says so", async ({ page, fake }) => {
    const be = await fake();
    const id = be.workspaces[0]!.workspace_id;
    await page.goto(`/?tab=editor&workspace=${id}`);
    await selectBase(page, 7);
    const ref = await baseOption(page, 7).getAttribute("data-base");
    const alt = ref === "A" ? "G" : "A";
    // in-page latency: click event -> the DNA mirror (same store the helix reads) shows the draft base
    await page.evaluate((a) => {
      const w = window as unknown as { __draftMs?: number };
      const btn = document.querySelector(`[data-testid="alt-${a}"]`)!;
      const opt = document.querySelector('[data-testid="base-list"] [role="option"][data-position="7"]')!;
      btn.addEventListener("click", () => {
        const t0 = performance.now();
        new MutationObserver((_, mo) => { if (opt.getAttribute("data-base") === a) { w.__draftMs = performance.now() - t0; mo.disconnect(); } }).observe(opt, { attributes: true });
      }, { once: true, capture: true });
    }, alt);
    await page.getByTestId(`alt-${alt}`).click();
    await expect(baseOption(page, 7)).toHaveAttribute("data-base", alt, { timeout: 2_000 });
    const ms = await page.evaluate(() => (window as unknown as { __draftMs?: number }).__draftMs ?? -1);
    test.info().annotations.push({ type: "draft-latency-ms", description: ms.toFixed(1) });
    expect(ms, "draft preview applied in the same interaction, without a network round trip").toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(500);
    await expect(page.getByTestId("no-body-effect")).toContainText(/No validated body-level effect/i);
    const d = be.handle("GET", `${V}/${id}/body-descriptor`).json as { anatomy_changed: boolean; effect_class: string };
    expect(d).toMatchObject({ anatomy_changed: false, effect_class: "ILLUSTRATIVE" });
  });
});

test.describe("MOCKED flow B: text edit", () => {
  test("B: 'change base 4 to A' -> proposal (exact ws + locus) -> confirm -> saved", async ({ page, fake }) => {
    const be = await fake();
    const id = be.workspaces[0]!.workspace_id;
    await flowTextEdit(page, { workspaceId: id, getWs: view(be, id), shotPrefix: "mocked-B" });
  });

  test("B: commit 409 (revision changed remotely) shows a conflict, never silently overwrites", async ({ page, fake }) => {
    const be = await fake({ forced: [{ match: /\/commit$/, method: "POST", status: 409, json: { detail: "revision_counter is 2, not 1" }, times: 1 }] });
    const id = be.workspaces[0]!.workspace_id;
    await page.goto(`/?tab=editor&workspace=${id}`);
    await selectBase(page, 4);
    await submitPrompt(page, "change base 4 to A");
    await expect(page.getByTestId("proposal-row").first()).toContainText(/Ready to review/i, { timeout: 20_000 });
    await page.getByTestId("confirm-save").click();
    await expect(page.getByTestId("commit-conflict").or(page.getByTestId("remote-conflict"))).toBeVisible({ timeout: 10_000 });
    expect(be.ws(id)!.edit_count).toBe(0);
  });

  test("B: proposal endpoint 500 -> honest error, nothing committed", async ({ page, fake }) => {
    const be = await fake({ forced: [{ match: /\/proposals$/, method: "POST", status: 500, json: { detail: "boom" } }] });
    const id = be.workspaces[0]!.workspace_id;
    const net = trackApi(page);
    await page.goto(`/?tab=editor&workspace=${id}`);
    await selectBase(page, 4);
    await submitPrompt(page, "change base 4 to A");
    await expect(page.getByTestId("composer-outcome").or(page.getByTestId("editor-error")).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("composer-outcome").or(page.getByTestId("proposal-preview")).first()).toContainText(/unavailable|could not|error/i);
    await expect(page.getByTestId("confirm-save"), "cannot confirm an edit whose validation failed").toBeDisabled();
    expect(net.posts(/\/commit$/)).toHaveLength(0);
    expect(be.ws(id)!.edit_count).toBe(0);
  });
});

test.describe("MOCKED flow C: voice (deterministic mock adapter, no microphone)", () => {
  test("C: transcript needs confirmation, then the edit needs its own confirmation", async ({ page, fake }) => {
    const be = await fake();
    const id = be.workspaces[0]!.workspace_id;
    await flowVoice(page, { workspaceId: id, getWs: view(be, id), shotPrefix: "mocked-C" });
  });
  for (const sc of [
    { name: "permission denied", error: "permission_denied" },
    { name: "network error", error: "network" },
    { name: "no speech", error: "no_speech" },
    { name: "unsupported browser", error: "unsupported" },
    { name: "cancel mid-capture", transcript: "change base 4 to A", stepMs: 2500, cancel: true },
  ]) {
    test(`C: ${sc.name} -> no request, no edit, text still works`, async ({ page, fake }) => {
      const be = await fake();
      await flowVoiceFailure(page, be.workspaces[0]!.workspace_id, sc);
    });
  }

  test("C: without a test adapter the UI is honest: server STT probe is 501 NOT_CONFIGURED", async ({ page, fake }) => {
    const be = await fake();
    await page.goto("/?tab=editor");
    await expect(page.getByTestId("base-list")).toBeAttached({ timeout: 30_000 });
    await page.getByTestId("mic-button").click();
    const cap = page.getByTestId("voice-capture");
    await expect(cap).toBeVisible();
    const kind = await cap.getAttribute("data-adapter");
    if (kind === "web-speech") {
      // progressive enhancement: privacy disclosure must be acknowledged before listening
      await expect(cap).toContainText(/audio may leave this device/i);
      await expect(page.getByRole("button", { name: "Start listening" })).toBeDisabled();
    } else {
      await expect(cap).toContainText("Voice transcription not configured");
    }
    await expect.poll(() => be.calls.filter((c) => c.path === "/api/voice/transcribe").map((c) => c.status)).toContain(501);
    await shot(page, "mocked-C-voice-unconfigured");
  });
});

test.describe("MOCKED flow F: cross-tab workspace selection", () => {
  test("F: library selection propagates; A->B->A race; refresh/deep link; unsaved-draft switch guard", async ({ page, fake }) => {
    test.setTimeout(150_000);
    const be = await fake({ delayMs: 120 });
    const a = be.workspaces[0]!;
    const b = be.createWorkspace("Second workspace");
    commitFake(be, b.workspace_id, 5, "A");
    be.activeId = a.workspace_id;
    const ref5 = be.ws(a.workspace_id)!.revisions![0]!.preview_1_48[4]!;
    await flowCrossTab(page, {
      a: { id: a.workspace_id, name: a.name, base5: ref5 },
      b: { id: b.workspace_id, name: b.name, base5: "A" },
      serverActive: async () => be.activeId,
      editCount: async (id) => be.ws(id)!.edit_count,
      shotPrefix: "mocked-F",
    });
  });
});

test.describe("MOCKED flow G: faults are shown honestly", () => {
  test("G: API down at boot -> offline state, no fake data, no crash", async ({ page, fake, collected, tolerate }) => {
    await fake({ down: true });
    tolerate(/Failed to load resource|net::ERR/i);
    await page.goto("/?tab=editor");
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-state", /offline|down|error|unreachable/i, { timeout: 20_000 });
    await expect(page.getByRole("tab")).toHaveCount(4);
    await expect(page.getByTestId("editor-status")).not.toContainText(/Validated/);
    await shot(page, "mocked-G-api-down-editor");
    expect(collected.pageErrors).toEqual([]);
  });

  test("G: simulation engine unreachable -> clearly STATIC example, never labelled live", async ({ page, fake, tolerate }) => {
    await fake();
    tolerate(/Failed to load resource|net::ERR/i);
    await page.route((u) => u.pathname === "/api/v10/evolution/simulations", (r) => (r.request().method() === "POST" ? r.abort("connectionrefused") : r.fallback()));
    await page.goto("/?tab=simulation");
    await page.getByRole("button", { name: /Run simulation/i }).click();
    await expect(page.getByTestId("static-example")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("static-example")).toContainText(/static|example|not live|illustrative/i);
    await expect(page.getByText("Simulation outcome")).toHaveCount(0);
    await shot(page, "mocked-G-engine-unreachable");
  });

  test("G: backend 409 budget text is surfaced verbatim", async ({ page, fake }) => {
    const detail = "generation budget exceeded: 80000 generations > 2000 (fake 409)";
    await fake({ forced: [{ match: /\/evolution\/simulations$/, method: "POST", status: 409, json: { detail } }] });
    await page.goto("/?tab=simulation");
    await page.getByRole("button", { name: /Run simulation/i }).click();
    await expect(page.getByText(detail, { exact: false })).toBeVisible({ timeout: 15_000 });
  });

  test("G: WebGL unavailable -> fallback visual + the DNA mirror still edits by keyboard", async ({ page, fake }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, t: string, ...r: unknown[]) {
        return /webgl/i.test(t) ? null : (orig as any).call(this, t, ...r);
      };
    });
    await fake();
    await page.goto("/?tab=editor");
    await expect(page.getByTestId("scene-host")).toHaveAttribute("data-webgl", /unsupported|error/, { timeout: 20_000 });
    await expect(page.getByTestId("webgl-fallback")).toBeAttached();
    await selectBase(page, 9);
    await expect(page.getByTestId("base-inspector")).toBeVisible();
    await shot(page, "mocked-G-no-webgl-editor");
  });
});

test.describe("MOCKED flow E: simulation playback with a fake clock", () => {
  test("E: 2,000,000 y -> 60 s: start / middle / end, pause, seek, speed; frames belong to the selected run", async ({ page, fake }) => {
    test.setTimeout(150_000);
    const be = await fake();
    const net = trackApi(page);
    await page.clock.install({ time: new Date("2026-10-11T12:00:00Z") });
    await page.goto("/?tab=simulation");
    await expect(page.getByRole("button", { name: /Run simulation/i })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole("button", { name: /Run simulation/i }).click();
    await expect(page.getByText("Simulation outcome").first()).toBeVisible({ timeout: 30_000 });
    const sims = [...be.sims.values()];
    expect(sims).toHaveLength(1);
    const sim = sims[0]!;
    expect(sim.simulated_years).toBe(2_000_000);
    expect(net.posts(/\/evolution\/simulations$/)[0]!.body).toMatchObject({ horizon_years: 2_000_000, generation_time_years: 1000 });
    await expectRunRecord(page, sim);
    const slider = page.getByRole("slider", { name: "Modelled year" });
    const freqAt = (y: number) => [...sim.frames].filter((f) => f.simulated_years <= y).pop()!.allele_frequency.toFixed(3);
    const year = async () => Number(await slider.inputValue());

    await slider.fill("0");
    expect(await year()).toBe(0);
    await expect(page.getByTestId("frame-readout")).toContainText(freqAt(0));
    await page.getByRole("button", { name: /Play playback|Replay/ }).click();
    await page.clock.runFor(30_000);
    const mid = await year();
    expect(mid, "30 s of 60 s => ~1,000,000 y").toBeGreaterThan(950_000);
    expect(mid).toBeLessThan(1_050_000);
    await expect(page.getByTestId("frame-readout")).toContainText(freqAt(mid));
    // pause: time does not advance
    await page.getByRole("button", { name: "Pause playback" }).click();
    const paused = await year();
    await page.clock.runFor(10_000);
    expect(await year()).toBe(paused);
    // resume to the end
    await page.getByRole("button", { name: "Play playback" }).click();
    await page.clock.runFor(31_000);
    expect(await year()).toBe(2_000_000);
    await expect(page.getByRole("button", { name: "Replay" })).toBeVisible();
    await expect(page.getByTestId("frame-readout")).toContainText(freqAt(2_000_000));
    // speed x2: 15 s from the start => 1,000,000 y
    await page.getByRole("button", { name: "Restart from year 0" }).click();
    await page.getByRole("button", { name: "×2" }).click();
    await page.getByRole("button", { name: /Play playback|Replay/ }).click();
    await page.clock.runFor(15_000);
    const fast = await year();
    expect(fast).toBeGreaterThan(950_000);
    expect(fast).toBeLessThan(1_050_000);
    await page.getByRole("button", { name: "Pause playback" }).click();
    // seek: readout shows the latest RECORDED frame at or before the year
    await slider.fill("1500000");
    await expect(page.getByTestId("frame-readout")).toContainText(freqAt(1_500_000));
    await shot(page, "mocked-E-playback");

    // parameter edits change only the draft: no request, no new result, the completed run stays on screen
    await page.clock.resume(); // real time again: actionability checks wait on animation frames
    net.clear();
    const seed = page.getByRole("spinbutton", { name: /^Seed\b/i }).first();
    await seed.fill("7");
    await seed.blur();
    await page.waitForTimeout(500);
    expect(net.posts(/\/evolution\/simulations$/)).toHaveLength(0);
    expect(be.sims.size).toBe(1);
    await expectRunRecord(page, sim);
  });
});

