import type { Page } from "@playwright/test";
import path from "path";
import { SHOTS } from "./fixtures";

/**
 * "Are both 3D subjects on screen?" without reaching into three.js: hide every DOM overlay (keep only the canvas and
 * its ancestors), screenshot, then count lit pixels (luma >= 70/255) in the body column (left 4-40% of the width)
 * and the helix column (50-96%), between the top bar and the bottom 10%. Fractions of the band area are returned.
 * Software rendering (SwiftShader) is slow, so callers should wait for a few frames first.
 */
export async function subjectsLit(page: Page, saveAs?: string) {
  const style = await page.addStyleTag({ content: "body *:not(canvas):not(:has(canvas)) { visibility: hidden !important; }" });
  await page.waitForTimeout(400);
  const png = await page.screenshot({ path: saveAs ? path.join(SHOTS, `${saveAs}.png`) : undefined });
  await style.evaluate((el) => (el as Element).remove());
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, img.width, img.height);
    const band = (x0: number, x1: number) => {
      let lit = 0, n = 0;
      const y0 = Math.round(height * 0.1), y1 = Math.round(height * 0.9);
      for (let y = y0; y < y1; y += 2)
        for (let x = Math.round(width * x0); x < Math.round(width * x1); x += 2) {
          const i = (y * width + x) * 4;
          const luma = 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
          n++;
          if (luma >= 70) lit++;
        }
      return n ? +(lit / n).toFixed(4) : 0;
    };
    return { body: band(0.04, 0.4), helix: band(0.5, 0.96) };
  }, png.toString("base64"));
}
