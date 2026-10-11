// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "fs";
import path from "path";
import { GenomeEditorTab } from "../../src/v12/editor/GenomeEditorTab";
import { PromptComposer } from "../../src/v12/editor/PromptComposer";
import { EvidenceDrawer } from "../../src/features/genome-editor/EvidenceDrawer";
import { useSession } from "../../src/v12/state/session";
import { useAnatomySelection } from "../../src/v14/state/anatomySelection";
import { installFakeFetch } from "../support/fetchFake";

let restore = () => {};
afterEach(() => {
  restore();
  useSession.setState({ drafts: {}, selectedPosition: null, activeWorkspaceId: null, reducedMotion: false });
  useAnatomySelection.getState().clear();
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("first viewport copy and testids", () => {
  it("composer placeholder, mic, Explore body parts, inspect-proposal", () => {
    render(
      <PromptComposer
        selectedPosition={null}
        onSubmit={() => ({ tone: "ok", message: "ok" })}
        status={null}
        onExploreBody={() => undefined}
      />,
    );
    const input = screen.getByTestId("prompt-input") as HTMLInputElement;
    expect(input.placeholder).toBe("What would you like to explore or edit?");
    expect(screen.getByTestId("mic-button")).toBeTruthy();
    expect(screen.getByTestId("inspect-proposal")).toBeTruthy();
    expect(screen.getByTestId("explore-body-parts").textContent).toContain("Explore body parts");
    expect(screen.getByTestId("parsed-locally-label").textContent).toContain("Parsed locally");
  });

  it("GenomeEditorTab first screen: strip honesty labels, no inspector, no tablist", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    render(wrap(<GenomeEditorTab />));
    await waitFor(() => expect(screen.getByTestId("genome-editor-tab").getAttribute("data-ready")).toBe("true"));
    expect(screen.getByTestId("prompt-input").getAttribute("placeholder")).toBe("What would you like to explore or edit?");
    expect(screen.getByTestId("mic-button")).toBeTruthy();
    expect(screen.getByTestId("inspect-proposal")).toBeTruthy();
    expect(screen.getByTestId("explore-body-parts")).toBeTruthy();
    expect(screen.getByTestId("editor-status").textContent).toContain("Baseline");
    expect(screen.getByTestId("reference-label").textContent).toMatch(/chr22|synthetic/i);
    expect(screen.getByTestId("synthetic-label").textContent).toMatch(/not GRCh38/i);
    expect(screen.getByTestId("base-list")).toBeTruthy();
    expect(screen.queryByTestId("base-inspector")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByTestId("evidence-drawer")).toBeNull();
  });

  it("Explore body parts opens the stacked evidence drawer (not a tablist)", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const user = userEvent.setup();
    render(wrap(<GenomeEditorTab />));
    await waitFor(() => expect(screen.getByTestId("genome-editor-tab").getAttribute("data-ready")).toBe("true"));
    await user.click(screen.getByTestId("explore-body-parts"));
    expect(screen.getByTestId("evidence-drawer")).toBeTruthy();
    expect(screen.getByTestId("evidence-anatomy")).toBeTruthy();
    expect(screen.getByTestId("evidence-genes")).toBeTruthy();
    expect(screen.getByTestId("evidence-associations")).toBeTruthy();
    expect(screen.getByTestId("evidence-sequence")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("evidence drawer contract", () => {
  it("Escape closes and sections are buttons, not tabs", async () => {
    useAnatomySelection.getState().openDrawer();
    render(wrap(<EvidenceDrawer open />));
    expect(screen.getByTestId("evidence-drawer").querySelector("[role='tablist']")).toBeNull();
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(useAnatomySelection.getState().drawerOpen).toBe(false);
  });
});

describe("first-viewport source copy", () => {
  it("owned editor sources keep required testids and forbid a tablist", () => {
    const roots = [
      path.resolve(__dirname, "../../src/v12/editor"),
      path.resolve(__dirname, "../../src/features/genome-editor"),
    ];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p);
      }
    };
    roots.forEach(walk);
    const joined = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    for (const id of ["prompt-input", "mic-button", "inspect-proposal", "editor-status", "synthetic-label", "reference-label", "base-list", "base-inspector", "confirm-save", "saved-notice", "discard", "restore-baseline"]) {
      expect(joined, id).toContain(`data-testid="${id}"`);
    }
    expect(joined).toContain("What would you like to explore or edit?");
    expect(joined).toContain("Explore body parts");
    expect(joined).not.toMatch(/role=["']tablist["']/);
    expect(joined).toContain("Genes with evidence in this tissue");
    expect(joined).not.toMatch(/genes that control/i);
  });
});
