import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export interface Box { sel: string; x: number; y: number; w: number; h: number; text: string }

const INTERACTIVE = 'button, a[href], input, textarea, select, summary, [role="tab"], [role="option"], [role="slider"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

/** Visible interactive elements that are clipped by the viewport, obscured by another element, or overlap a sibling control. */
export async function layoutProblems(page: Page, opts: { minTarget?: number } = {}) {
  return page.evaluate(
    ({ sel, minTarget }) => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const describe = (el: Element) => {
        const id = el.id ? `#${el.id}` : "";
        const cls = typeof (el as HTMLElement).className === "string" ? "." + (el as HTMLElement).className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
        const label = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || "").trim().replace(/\s+/g, " ").slice(0, 40);
        return `${el.tagName.toLowerCase()}${id}${cls} "${label}"`;
      };
      const els = Array.from(document.querySelectorAll(sel)).filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
        if (el.closest("[aria-hidden='true'], [inert], .sr-only")) return false;
        if (cs.position === "absolute" && (r.width <= 1 || r.height <= 1)) return false;
        // skip skip-links that are visually hidden until focus
        if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) return false;
        return true;
      });
      const clipped: string[] = [], obscured: string[] = [], overlaps: string[] = [], tiny: string[] = [];
      const boxes = els.map((el) => ({ el, r: el.getBoundingClientRect() }));
      for (const { el, r } of boxes) {
        if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) clipped.push(`${describe(el)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} vs ${vw}x${vh}`);
        if (r.width < minTarget || r.height < minTarget) {
          // inline text links inside paragraphs are exempt (WCAG 2.5.8 inline exception)
          const inline = el.tagName === "A" && getComputedStyle(el).display === "inline";
          if (!inline) tiny.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
        const top = document.elementFromPoint(cx, cy);
        if (top && top !== el && !el.contains(top) && !top.contains(el)) obscured.push(`${describe(el)} covered by ${describe(top)}`);
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (ox > 3 && oy > 3) overlaps.push(`${describe(a.el)} x ${describe(b.el)} (${Math.round(ox)}x${Math.round(oy)})`);
        }
      const se = document.scrollingElement!;
      const hScroll = se.scrollWidth - se.clientWidth;
      return { clipped, obscured, overlaps, tiny, hScroll, interactive: els.length };
    },
    { sel: INTERACTIVE, minTarget: opts.minTarget ?? 24 },
  );
}

export async function axeScan(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const serious = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  return {
    label,
    serious,
    all: res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) })),
    incomplete: res.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })),
  };
}

/** Tab through the page and report focus path quality (traps, invisible focus, missing ring). */
export async function keyboardTraversal(page: Page, maxStops = 80) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  const stops: { desc: string; visible: boolean; ring: boolean; inViewport: boolean }[] = [];
  const seen = new Map<string, number>();
  let trapped = false;
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { desc: "BODY", visible: true, ring: true, inViewport: true, key: "BODY" };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const path = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}[${el.getAttribute("role") ?? ""}] "${label}"`;
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
      return { desc: path, visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden", ring: !!ring, inViewport: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth, key: path + `@${Math.round(r.left)},${Math.round(r.top)}` };
    });
    stops.push(s);
    const n = (seen.get(s.key) ?? 0) + 1;
    seen.set(s.key, n);
    if (s.desc === "BODY" && i > 0) break; // wrapped around to the browser chrome: no trap
    if (n > 3) { trapped = true; break; }
  }
  return { stops, trapped, distinct: seen.size };
}
