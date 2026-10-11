// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GenomeEditorTab } from "../../src/v12/editor/GenomeEditorTab";
import { useSession } from "../../src/v12/state/session";
import { useAnatomySelection } from "../../src/v14/state/anatomySelection";
import { installFakeFetch } from "../support/fetchFake";
import { intentCreatesDraft, routePrompt } from "../../src/v12/editor/promptRouter";

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

describe("explore and trait goals do not mutate the draft", () => {
  it("routePrompt explore/trait never create a draft payload", () => {
    for (const t of ["show the left hand", "genes in the retina", "stronger legs", "bigger hands"]) {
      expect(intentCreatesDraft(routePrompt(t, { selectedPosition: null, windowStart: 1, windowEnd: 48, contig: "chr22" })), t).toBe(false);
    }
  });

  it("submitting an explore command leaves the session draft empty", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const user = userEvent.setup();
    render(wrap(<GenomeEditorTab />));
    await waitFor(() => expect(screen.getByTestId("genome-editor-tab").getAttribute("data-ready")).toBe("true"));
    await user.type(screen.getByTestId("prompt-input"), "show the left hand");
    await user.click(screen.getByTestId("inspect-proposal"));
    await waitFor(() => expect(useAnatomySelection.getState().anatomyId).toBe("UBERON:0002398@left"));
    const drafts = Object.values(useSession.getState().drafts);
    expect(drafts.every((d) => !d || d.ops.length === 0)).toBe(true);
    expect(screen.queryByTestId("proposal-preview")).toBeNull();
  });

  it("submitting a trait goal never opens a proposal", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const user = userEvent.setup();
    render(wrap(<GenomeEditorTab />));
    await waitFor(() => expect(screen.getByTestId("genome-editor-tab").getAttribute("data-ready")).toBe("true"));
    await user.type(screen.getByTestId("prompt-input"), "stronger legs");
    await user.click(screen.getByTestId("inspect-proposal"));
    await waitFor(() => expect(screen.getByTestId("composer-outcome").textContent).toMatch(/not a single-base/i));
    const drafts = Object.values(useSession.getState().drafts);
    expect(drafts.every((d) => !d || d.ops.length === 0)).toBe(true);
    expect(screen.queryByTestId("proposal-preview")).toBeNull();
  });

  it("an ultraviolet wish shows a research proposal and does not draft DNA", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const user = userEvent.setup();
    render(wrap(<GenomeEditorTab />));
    await waitFor(() => expect(screen.getByTestId("genome-editor-tab").getAttribute("data-ready")).toBe("true"));
    await user.type(screen.getByTestId("prompt-input"), "Make the virtual organism more resistant to ultraviolet radiation.");
    await user.click(screen.getByTestId("inspect-proposal"));
    await waitFor(() => expect(screen.getByTestId("research-proposal")).toBeTruthy());
    expect(screen.getByTestId("research-user_intent").textContent).toBe("Explore increased UV tolerance");
    expect(screen.getByTestId("research-candidate_edit").textContent).toBe("Pending evidence-based identification");
    expect((screen.getByTestId("research-approve") as HTMLButtonElement).disabled).toBe(true);
    const drafts = Object.values(useSession.getState().drafts);
    expect(drafts.every((d) => !d || d.ops.length === 0)).toBe(true);
    expect(screen.queryByTestId("proposal-preview")).toBeNull();
  });

  it("reduced motion still drafts a precise edit", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    useSession.setState({ reducedMotion: true });
    const user = userEvent.setup();
    render(wrap(<GenomeEditorTab />));
    await waitFor(() => expect(screen.getByTestId("genome-editor-tab").getAttribute("data-ready")).toBe("true"));
    await user.type(screen.getByTestId("prompt-input"), "change base 4 to A");
    await user.click(screen.getByTestId("inspect-proposal"));
    await waitFor(() => {
      const ops = Object.values(useSession.getState().drafts).flatMap((d) => d?.ops ?? []);
      expect(ops.some((o) => o.position === 4 && o.alt === "A")).toBe(true);
    });
    expect(screen.getByTestId("proposal-preview")).toBeTruthy();
  });
});
