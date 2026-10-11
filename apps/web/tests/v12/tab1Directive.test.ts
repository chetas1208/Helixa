import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import * as helix from "../../src/v12/editor/helixGeometry";
import { buildBodyGeometry, sampleSurface } from "../../src/v12/editor/bodyGeometry";

/**
 * Tab 1 user directive (2026-10-11): no sub-tabs inside the Genome Editor (no DNA/Body toggle, no Front/Back
 * toggle); body and DNA are ALWAYS both visible; the body is big; DNA draft edits render instantly while the
 * body only acknowledges them with an illustrative scan pulse and never changes anatomy.
 */
const SRC = path.resolve(__dirname, "../../src/v12/editor");
const read = (f: string) => fs.readFileSync(path.join(SRC, f), "utf8");
const editorFiles = fs.readdirSync(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const VIEWPORTS = [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
] as const;

interface LayoutLike { bodyX: number; bodyY: number; bodyScale: number; helixX: number; helixY: number; helixScale: number; ppu: number }
// Loose call: the lead is reshaping LayoutInput; the geometric contract below is what must hold.
const layout = (w: number, h: number) =>
  (helix.computeSceneLayout as unknown as (i: Record<string, unknown>) => LayoutLike)({ fovDeg: 45, split: false, helixBases: 48, viewWidth: w, viewHeight: h, aspect: w / h });

function screenBoxes(w: number, h: number) {
  const L = layout(w, h);
  const toPx = (x: number, y: number) => ({ x: w / 2 + x * L.ppu, y: h / 2 - y * L.ppu });
  const bc = toPx(L.bodyX, L.bodyY);
  const bw = helix.BODY_WIDTH * L.bodyScale * L.ppu, bh = helix.BODY_HEIGHT * L.bodyScale * L.ppu;
  const hc = toPx(L.helixX, L.helixY);
  const hw = helix.HELIX_RADIUS * 2 * L.helixScale * L.ppu, hh = helix.helixHeight(48) * L.helixScale * L.ppu;
  return {
    L,
    body: { left: bc.x - bw / 2, right: bc.x + bw / 2, top: bc.y - bh / 2, bottom: bc.y + bh / 2, h: bh },
    helix: { left: hc.x - hw / 2, right: hc.x + hw / 2, top: hc.y - hh / 2, bottom: hc.y + hh / 2, h: hh },
  };
}

describe("Tab 1: body and DNA are both on screen at every viewport (no view toggle)", () => {
  it.each(VIEWPORTS)("%ix%i: both subjects inside the viewport, side by side, not overlapping", (w, h) => {
    const { L, body, helix: hx } = screenBoxes(w, h);
    expect(L.bodyScale).toBeGreaterThan(0);
    expect(L.helixScale, "helix drawn at a positive scale").toBeGreaterThan(0);
    for (const [name, b] of [["body", body], ["helix", hx]] as const) {
      expect(b.left, `${name} left edge`).toBeGreaterThanOrEqual(-1);
      expect(b.right, `${name} right edge`).toBeLessThanOrEqual(w + 1);
      expect(b.top, `${name} top edge`).toBeGreaterThanOrEqual(-1);
      expect(b.bottom, `${name} bottom edge`).toBeLessThanOrEqual(h + 1);
    }
    expect(body.right, "body sits left of the helix (no overlap)").toBeLessThanOrEqual(hx.left + 1);
    expect(hx.h / h, "helix is a readable size (>= 25% of the viewport height)").toBeGreaterThanOrEqual(0.25);
  });

  it.each(VIEWPORTS)("%ix%i: the body is BIG (>= 60% of the viewport height on desktop/laptop, >= 35% on tablet/phone)", (w, h) => {
    const { body } = screenBoxes(w, h);
    const min = w >= 1024 ? 0.6 : 0.35;
    expect(body.h / h).toBeGreaterThanOrEqual(min);
  });

  it("the layout input has no view/subtab switch any more (DNA-or-body choice removed)", () => {
    const scene = strip(read("EditorScene.tsx"));
    expect(scene).not.toMatch(/mobileView|showBody|showHelix/);
  });
});

describe("Tab 1: no tabs inside the tab panel", () => {
  it("no tablist/tab roles, no DNA/Body mobile toggle, no Front/Back segmented toggle in editor source", () => {
    const hits: string[] = [];
    for (const f of editorFiles) {
      const s = strip(read(f));
      for (const re of [/role=["']tablist["']/, /role=["']tab["']/, /mobile-view-toggle/, /aria-label=["']Body figure view["']/, /aria-label=["']Show["']/, /data-testid=\{?[`"']mobile-/]) {
        if (re.test(s)) hits.push(`${f}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("Tab 1: no body morphology from a sequence edit", () => {
  it("body geometry takes no input at all and is deterministic", () => {
    expect(buildBodyGeometry.length).toBe(0);
    const a = buildBodyGeometry(), b = buildBodyGeometry();
    const pa = a.getAttribute("position").array as Float32Array, pb = b.getAttribute("position").array as Float32Array;
    expect(pa.length).toBeGreaterThan(300);
    expect(Buffer.from(pa.buffer).equals(Buffer.from(pb.buffer))).toBe(true);
    const sa = sampleSurface(a, 500), sb = sampleSurface(b, 500);
    expect(Buffer.from(sa.buffer).equals(Buffer.from(sb.buffer))).toBe(true);
  });

  it("BodyFigure / bodyGeometry never read genomic data (bases, drafts, edits, alleles)", () => {
    const seqFields = /\b(draftBases|savedBases|baselineBases|originalBases|proposedAlt|selectedPosition|DraftOp|EditDraft|preview_1_48|edits)\b/;
    for (const f of ["BodyFigure.tsx", "bodyGeometry.ts"]) expect(strip(read(f)), f).not.toMatch(seqFields);
    expect(strip(read("BodyFigure.tsx"))).not.toMatch(/from\s+["']\.\/(editorModel|draftReducer|promptParser|useDraftReview)["']/);
  });

  it("the scene passes the body figure no sequence-derived prop", () => {
    const scene = strip(read("EditorScene.tsx"));
    const tags = scene.match(/<BodyFigure\b[^>]*>/g) ?? [];
    expect(tags.length, "EditorScene renders the body figure").toBeGreaterThan(0);
    for (const t of tags) expect(t).not.toMatch(/bases|draft|alt=|edits|position/i);
  });
});
