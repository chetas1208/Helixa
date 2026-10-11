import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FACE } from "../../src/features/anatomy/ids";
import { TAB_ORDER, TAB_TITLES } from "../../src/v12/types";

describe("HELIXA display identity", () => {
  it("uses the locked tab names and keeps anatomy ids", () => {
    expect(TAB_ORDER.map((id) => TAB_TITLES[id])).toEqual([
      "Genome Editor",
      "Genome & Harness Evolution",
      "Earth Evolution Sandbox",
      "Harness Library",
    ]);
    expect(FACE.startsWith("DIAMOND:")).toBe(true);
  });

  it("puts HELIXA in the document title and favicon", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(html).toContain("<title>HELIXA</title>");
    expect(html).toContain("/favicon.svg");
    expect(html).not.toContain("DIAMOND Genome");
  });
});
