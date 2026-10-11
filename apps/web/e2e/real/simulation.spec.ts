import { test, expect, shot, API } from "../support/fixtures";
import { apiCreateWorkspace, trackApi, uniq } from "../support/helpers";
import { expectRunRecord } from "../support/flows";

/** REAL flow E: Earth Simulation end to end against the live engine. */
async function setField(page: import("@playwright/test").Page, label: RegExp | string, value: string) {
  // number inputs only: section headings (aria-labelledby) and the paired range sliders share the words
  const f = page.getByRole("spinbutton", { name: label }).first();
  await f.fill(value);
  await f.blur();
}

test.describe("REAL flow E: simulation", () => {
  test("supported vs exploratory parameters are labelled; 2M years declares >=1000 y/gen; 25 y/gen never reaches the backend", async ({ page, request }) => {
    const ws = await apiCreateWorkspace(request, uniq("e2e-E0"));
    const net = trackApi(page);
    await page.goto(`/?tab=simulation&workspace=${ws.workspace_id}`);
    await expect(page.getByText("Supported (wired to model)")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Exploratory / not supported").first()).toBeVisible();
    await expect(page.getByText(/does not change allele counts/i).first()).toBeVisible();
    await expect(page.getByText(/at least 1,000 y\/gen/i)).toBeVisible();
    await expect(page.getByText("Draft, not a result")).toBeVisible();
    // force 25 y/gen
    await setField(page, /Generation time/i, "25");
    const run = page.getByRole("button", { name: /Run simulation/i });
    if (await run.isEnabled()) await run.click();
    await page.waitForTimeout(800);
    const sent = net.posts(/\/evolution\/simulations$/).filter((c) => (c.body as { generation_time_years?: number })?.generation_time_years === 25);
    // Spec: "never fake a 25-year run; surface backend 409 text". Honest minimum: if it IS sent, the 409 is shown and no result appears.
    if (sent.length) {
      await expect(page.getByText(/Run refused by the engine \(HTTP 409\)/)).toBeVisible();
      await expect(page.getByText(/Simulation outcome/)).toHaveCount(0);
    }
    // Defect S-2 (low): lead brief asks that the UI not call the backend at all with 25 y/gen over 2,000,000 y.
    expect.soft(sent, "UI submitted a known-invalid 25 y/generation scenario (no client-side pre-check)").toEqual([]);
  });

  test("run -> real frames -> scrub 0/mid/end -> 60 s replay (accelerated clock) -> second seed differs", async ({ page, request }) => {
    test.setTimeout(180_000);
    const ws = await apiCreateWorkspace(request, uniq("e2e-E"));
    const net = trackApi(page);
    await page.clock.install({ time: new Date("2026-10-11T12:00:00Z") });
    await page.goto(`/?tab=simulation&workspace=${ws.workspace_id}`);
    await expect(page.getByRole("button", { name: /Run simulation/i })).toBeEnabled({ timeout: 30_000 });
    await page.clock.resume();

    await page.getByRole("button", { name: /Run simulation/i }).click();
    await expect(page.getByText("Simulation outcome").first()).toBeVisible({ timeout: 60_000 });
    const posts = net.posts(/\/evolution\/simulations$/);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.status).toBe(200);
    expect(posts[0]!.body).toMatchObject({ workspace_id: ws.workspace_id, horizon_years: 2_000_000, generation_time_years: 1000 });
    expect(posts[0]!.headers["idempotency-key"]).toBeTruthy();

    // the run on screen is the run the API stored for this workspace
    const list = await (await request.get(`${API}/api/v10/evolution/simulations?workspace_id=${ws.workspace_id}`)).json();
    expect(list.simulations).toHaveLength(1);
    const sim = list.simulations[0] as { simulation_id: string; result_sha256: string; frames: { simulated_years: number; allele_frequency: number }[]; workspace_id: string; genome_revision_id: string };
    expect(sim.workspace_id).toBe(ws.workspace_id);
    expect(sim.genome_revision_id, "run computed on the workspace's active revision").toBe((await (await request.get(`${API}/api/v10/genome/workspaces/${ws.workspace_id}`)).json()).active_genome_revision_id);
    await expectRunRecord(page, sim);
    await shot(page, "real-E-run-complete-1440x900");

    // scrub 0 / mid / end: the readout shows the latest RECORDED frame at or before that year
    const slider = page.getByRole("slider", { name: "Modelled year" });
    const frameAt = (y: number) => [...sim.frames].filter((f) => f.simulated_years <= y).pop()!;
    for (const [year, label] of [[0, "start"], [1_000_000, "mid"], [2_000_000, "end"]] as const) {
      await slider.fill(String(year));
      const f = frameAt(year);
      await expect(page.getByTestId("frame-readout"), label).toContainText(f.allele_frequency.toFixed(3));
    }

    // 60 s replay with an accelerated clock: 30 s -> mid, 60 s -> end
    await slider.fill("0");
    await page.getByRole("button", { name: /Play playback|Replay/ }).click();
    await page.clock.runFor(30_000);
    const mid = Number(await slider.inputValue());
    expect(mid, "after 30 s of a 60 s replay the modelled year is ~1,000,000").toBeGreaterThan(900_000);
    expect(mid).toBeLessThan(1_100_000);
    await page.clock.runFor(31_000);
    expect(Number(await slider.inputValue())).toBe(2_000_000);
    await expect(page.getByRole("button", { name: /Replay/ })).toBeVisible();
    await shot(page, "real-E-replay-end-1440x900");

    // second seed -> a different real result; the first run is not destroyed
    await setField(page, /^Seed\b/i, "2");
    await page.getByRole("button", { name: /Run simulation/i }).click();
    await expect.poll(async () => (await (await request.get(`${API}/api/v10/evolution/simulations?workspace_id=${ws.workspace_id}`)).json()).simulations.length, { timeout: 60_000 }).toBe(2);
    const list2 = await (await request.get(`${API}/api/v10/evolution/simulations?workspace_id=${ws.workspace_id}`)).json();
    const hashes = new Set(list2.simulations.map((s: { result_sha256: string }) => s.result_sha256));
    expect(hashes.size, "a different seed must give a different result").toBe(2);
    await shot(page, "real-E-two-seeds-1440x900");
  });
});
