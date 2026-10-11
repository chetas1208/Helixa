// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnatomyFallback2D, AnatomyTree } from "../../src/features/anatomy";
import { useAnatomySelection } from "../../src/v14/state/anatomySelection";
import { searchLocalTree } from "../../src/features/anatomy/treeModel";
import { HAND_L, HAND_R, HEAD } from "../../src/features/anatomy/ids";
import localTree from "../../src/features/anatomy/anatomyTree.local.json";
import type { LocalTreeFixture } from "../../src/features/anatomy/types";

const tree = localTree as LocalTreeFixture;

afterEach(() => {
  useAnatomySelection.getState().clear();
});

describe("local atlas search", () => {
  it("finds left hand without returning the right hand id", () => {
    const hits = searchLocalTree(tree, "left hand");
    expect(hits.some((h) => h.id === HAND_L)).toBe(true);
    expect(hits.some((h) => h.id === HAND_R)).toBe(false);
  });

  it("matches head from the local fixture", () => {
    const exact = searchLocalTree(tree, "head");
    expect(exact.some((h) => h.id === HEAD)).toBe(true);
  });
});

describe("AnatomyTree", () => {
  it("labels a 404/missing API as the local atlas fixture and can select a node", async () => {
    const restore = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/anatomy/")) return new Response("missing", { status: 404 });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    render(createElement(AnatomyTree));
    const host = await screen.findByTestId("anatomy-tree");
    expect(host.getAttribute("data-source")).toBe("local-atlas-fixture");
    expect(screen.getByText(/local atlas fixture/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Head" }));
    expect(useAnatomySelection.getState().anatomyId).toBe(HEAD);
    globalThis.fetch = restore;
  });
});

describe("AnatomyFallback2D", () => {
  it("clicking the left-hand region writes the left-hand id", () => {
    render(createElement(AnatomyFallback2D));
    fireEvent.click(screen.getByRole("button", { name: "Left hand (left)" }));
    expect(useAnatomySelection.getState().anatomyId).toBe(HAND_L);
    expect(useAnatomySelection.getState().anatomyId).not.toBe(HAND_R);
  });
});
