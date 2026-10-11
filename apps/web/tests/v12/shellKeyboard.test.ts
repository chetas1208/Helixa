// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { isTypingTarget, tabForKey } from "../../src/v12/shell/hotkeys";
import { resolveRenderSettings } from "../../src/v12/shell/renderPrefs";
import { TAB_ORDER } from "../../src/v12/types";

describe("keyboard: digits 1-4 select the four tabs, never while typing", () => {
  it("1..4 map to the tabs in order; 0, 5-9, letters and multi-char keys do nothing", () => {
    expect(["1", "2", "3", "4"].map(tabForKey)).toEqual([...TAB_ORDER]);
    for (const k of ["0", "5", "9", "a", "Enter", "12", "", " ", "F1"]) expect(tabForKey(k), k).toBeNull();
  });

  it("text fields, selects, contenteditable, listbox/slider widgets and dialogs/menus swallow digits", () => {
    const mk = (html: string) => {
      document.body.innerHTML = html;
      return document.body.querySelector("[data-t]") as HTMLElement;
    };
    for (const html of [
      '<input data-t>',
      '<textarea data-t></textarea>',
      '<select data-t></select>',
      '<div contenteditable="true" data-t></div>',
      '<div role="listbox" data-t tabindex="0"></div>',
      '<div role="slider" data-t tabindex="0"></div>',
      '<div role="dialog"><button data-t>x</button></div>',
      '<div role="menu"><button data-t>x</button></div>',
    ]) {
      const el = mk(html);
      // jsdom does not implement isContentEditable; emulate the browser for that one case
      if (el.getAttribute("contenteditable") === "true") Object.defineProperty(el, "isContentEditable", { value: true });
      expect(isTypingTarget(el), html).toBe(true);
    }
    expect(isTypingTarget(mk('<button data-t>tab</button>'))).toBe(false);
    expect(isTypingTarget(mk('<div role="tab" data-t tabindex="0"></div>'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("render settings: fallback / low-power paths are deterministic", () => {
  it("explicit preferences win; low tier caps FPS and disables antialias", () => {
    expect(resolveRenderSettings("low")).toMatchObject({ tier: "low", fpsCap: 30, lowPower: true, antialias: false });
    expect(resolveRenderSettings("high", { hardwareConcurrency: 2 })).toMatchObject({ tier: "high" });
  });
  it("auto detection degrades on weak devices and Save-Data", () => {
    expect(resolveRenderSettings("auto", { saveData: true }).tier).toBe("low");
    expect(resolveRenderSettings("auto", { hardwareConcurrency: 4 }).tier).toBe("low");
    expect(resolveRenderSettings("auto", { deviceMemory: 2, hardwareConcurrency: 16 }).tier).toBe("low");
    expect(resolveRenderSettings("auto", { hardwareConcurrency: 16, deviceMemory: 16 }).tier).toBe("high");
    expect(resolveRenderSettings("auto", {}).tier).toBe("balanced");
  });
});
