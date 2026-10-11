import fs from "fs";
import path from "path";
import { test, expect, TAB_NAMES, REPO, shot, openApp } from "../support/fixtures";
import { axeScan, keyboardTraversal, layoutProblems } from "../support/a11y";

/**
 * Flow H. REAL backend (throwaway state). Viewport matrix x four tabs: screenshots, layout assertions,
 * axe-core (zero serious/critical), keyboard traversal, reduced motion, forced colours.
 */
const VIEWPORTS = [
  { w: 1440, h: 900, name: "desktop-1440x900" },
  { w: 1280, h: 800, name: "laptop-1280x800" },
  { w: 1024, h: 768, name: "tablet-landscape-1024x768" },
  { w: 768, h: 1024, name: "tablet-portrait-768x1024" },
  { w: 390, h: 844, name: "phone-390x844" },
] as const;
const TABS = [
  { id: "editor", name: "Genome Editor" },
  { id: "evolution", name: "Genome & Harness Evolution" },
  { id: "simulation", name: "Earth Evolution Sandbox" },
  { id: "library", name: "Harness Library" },
] as const;
const OUT = path.join(REPO, "artifacts/frontend/v12");
fs.mkdirSync(OUT, { recursive: true });
const findings: Record<string, unknown> = {};
test.afterAll(() => {
  fs.writeFileSync(path.join(OUT, "layout-axe-findings.json"), JSON.stringify(findings, null, 2));
});

async function settle(page: import("@playwright/test").Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(1800);
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    for (const tab of TABS) {
      test(`${tab.name}: renders, no overflow/overlap/obscured controls, screenshot`, async ({ page, collected }) => {
        await openApp(page, `?tab=${tab.id}`);
        await settle(page);
        await shot(page, `${tab.id}-${vp.name}`);
        const p = await layoutProblems(page, { minTarget: vp.w <= 768 ? 24 : 20 });
        findings[`layout:${tab.id}:${vp.name}`] = p;
        expect(p.hScroll, "horizontal page scroll").toBeLessThanOrEqual(1);
        expect(p.clipped, "controls clipped by the viewport").toEqual([]);
        expect(p.obscured, "controls covered by another element").toEqual([]);
        expect(p.overlaps, "controls overlapping each other").toEqual([]);
        expect.soft(p.tiny, "tap targets below minimum").toEqual([]);
        expect(collected.pageErrors).toEqual([]);
        expect(collected.errors).toEqual([]);
      });
    }
  });
}

test.describe("axe-core: zero serious/critical violations on all four tabs", () => {
  for (const vp of [VIEWPORTS[0], VIEWPORTS[4]]) {
    test.describe(vp.name, () => {
      test.use({ viewport: { width: vp.w, height: vp.h } });
      for (const tab of TABS) {
        test(`${tab.name}`, async ({ page }) => {
          await openApp(page, `?tab=${tab.id}`);
          await settle(page);
          const r = await axeScan(page, `${tab.id}:${vp.name}`);
          findings[`axe:${tab.id}:${vp.name}`] = { all: r.all, incomplete: r.incomplete };
          expect(r.serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
        });
      }
    });
  }
});

test.describe("keyboard-only traversal", () => {
  for (const tab of TABS) {
    test(`${tab.name}: Tab order reaches controls, never traps, focus is visible`, async ({ page }) => {
      await openApp(page, `?tab=${tab.id}`);
      await settle(page);
      const r = await keyboardTraversal(page, 70);
      findings[`keyboard:${tab.id}`] = { distinct: r.distinct, trapped: r.trapped, stops: r.stops.map((s) => s.desc) };
      expect(r.trapped, "keyboard trap").toBe(false);
      expect(r.distinct, "focusable stops").toBeGreaterThanOrEqual(5);
      const bad = r.stops.filter((s) => s.desc !== "BODY" && (!s.visible || !s.ring));
      expect(bad.map((s) => s.desc), "focused elements without a visible focus indicator").toEqual([]);
    });
  }

  test("the tab strip is operable by keyboard alone and reaches every tab", async ({ page }) => {
    await openApp(page);
    await page.getByRole("tab", { name: "Genome Editor" }).focus();
    for (const name of TAB_NAMES.slice(1)) {
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    }
  });
});

test.describe("reduced motion and forced colours", () => {
  test("prefers-reduced-motion: no running infinite CSS animations and the shell stays usable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const tab of TABS) {
      await openApp(page, `?tab=${tab.id}`);
      await settle(page);
      const running = await page.evaluate(() =>
        document.getAnimations().filter((a) => {
          const t = a.effect?.getComputedTiming();
          return a.playState === "running" && (t?.iterations === Infinity || (t?.activeDuration as number) > 1000);
        }).map((a) => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "anim"} on ${(a.effect as KeyframeEffect)?.target?.tagName}`),
      );
      expect(running, `${tab.name}: long/infinite animations under reduced motion`).toEqual([]);
    }
    await shot(page, "reduced-motion-library-1440x900");
  });

  test("forced-colors: active: tabs, controls and text stay visible", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openApp(page, "?tab=library");
    await settle(page);
    await expect(page.getByRole("tab")).toHaveCount(4);
    for (const t of TAB_NAMES) await expect(page.getByRole("tab", { name: t, exact: true })).toBeVisible();
    const p = await layoutProblems(page);
    expect(p.obscured).toEqual([]);
    await shot(page, "forced-colors-library-1440x900");
  });

  test("color-scheme / text zoom 200%: no horizontal scroll on the tab strip", async ({ page }) => {
    await openApp(page, "?tab=editor");
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await settle(page);
    const p = await layoutProblems(page);
    expect.soft(p.hScroll).toBeLessThanOrEqual(1);
    await shot(page, "text-zoom-200-editor-1440x900");
  });
});
