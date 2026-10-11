import { describe, it, expect, beforeEach } from "vitest";
import { hasUnsavedDraft, useSession } from "../../src/v12/state/session";
import type { EditDraft } from "../../src/v12/types";

const draft = (ws: string, nOps: number): EditDraft => ({
  workspaceId: ws,
  baseRevisionId: "rev-1",
  baseCounter: 1,
  ops: Array.from({ length: nOps }, (_, i) => ({ position: i + 1, ref: "A", alt: "C" as const, origin: "manual" as const })),
  redo: [],
});

beforeEach(() => {
  useSession.setState({ activeTab: "editor", activeWorkspaceId: null, drafts: {}, selectedPosition: null, selectedRevisionId: null });
});

describe("useSession (client selection store)", () => {
  it("starts on the Genome Editor tab", () => {
    expect(useSession.getState().activeTab).toBe("editor");
  });

  it("switching workspace clears base selection and revision selection (no stale leakage)", () => {
    const s = useSession.getState();
    s.setActiveWorkspaceId("ws-A");
    s.setSelectedPosition(7);
    s.setSelectedRevisionId("rev-x");
    useSession.getState().setActiveWorkspaceId("ws-B");
    expect(useSession.getState().selectedPosition).toBeNull();
    expect(useSession.getState().selectedRevisionId).toBeNull();
    expect(useSession.getState().activeWorkspaceId).toBe("ws-B");
  });

  it("drafts are namespaced per workspace and never applied to another workspace", () => {
    const s = useSession.getState();
    s.setDraft("ws-A", draft("ws-A", 2));
    s.setActiveWorkspaceId("ws-A");
    expect(hasUnsavedDraft(useSession.getState())).toBe(true);
    useSession.getState().setActiveWorkspaceId("ws-B");
    expect(hasUnsavedDraft(useSession.getState())).toBe(false);
    useSession.getState().setActiveWorkspaceId("ws-A");
    expect(hasUnsavedDraft(useSession.getState())).toBe(true);
    expect(useSession.getState().drafts["ws-B"]).toBeUndefined();
  });

  it("hasUnsavedDraft is false for null workspace, empty ops and cleared drafts", () => {
    expect(hasUnsavedDraft({ activeWorkspaceId: null, drafts: {} })).toBe(false);
    expect(hasUnsavedDraft({ activeWorkspaceId: "w", drafts: { w: draft("w", 0) } })).toBe(false);
    expect(hasUnsavedDraft({ activeWorkspaceId: "w", drafts: { w: undefined } })).toBe(false);
  });

  it("switching tabs preserves workspace and drafts", () => {
    const s = useSession.getState();
    s.setActiveWorkspaceId("ws-A");
    s.setDraft("ws-A", draft("ws-A", 1));
    for (const t of ["evolution", "simulation", "library", "editor"] as const) useSession.getState().setActiveTab(t);
    expect(useSession.getState().activeWorkspaceId).toBe("ws-A");
    expect(hasUnsavedDraft(useSession.getState())).toBe(true);
  });
});
