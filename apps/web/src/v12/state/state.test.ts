import { describe, expect, it } from "vitest";
import { createLatestGate, createSerialQueue, onlyIfActive } from "./raceGuard";
import { decideHistoryMode, isWorkspaceId, parseUrlSelection, resolveBootstrapWorkspace, serialiseUrlSelection } from "./urlParams";

describe("url parse/serialise", () => {
  it("validates tab and workspace id; never throws", () => {
    expect(parseUrlSelection("?tab=library&workspace=ws-4b73b1e41102")).toEqual({ tab: "library", workspace: "ws-4b73b1e41102", issues: [] });
    const bad = parseUrlSelection("?tab=admin&workspace=../../etc/passwd");
    expect(bad.tab).toBeNull();
    expect(bad.workspace).toBeNull();
    expect(bad.issues).toHaveLength(2);
    expect(parseUrlSelection("").tab).toBeNull();
    expect(parseUrlSelection("?workspace=WS-ABC").workspace).toBeNull();
    expect(isWorkspaceId("ws-" + "a".repeat(200))).toBe(false);
  });
  it("serialises, preserves unrelated params, drops invalid workspace", () => {
    expect(serialiseUrlSelection({ tab: "editor", workspace: "ws-1a" }, "")).toBe("?tab=editor&workspace=ws-1a");
    expect(serialiseUrlSelection({ tab: "library", workspace: null }, "?tab=editor&workspace=ws-1a&debug=1")).toBe("?tab=library&debug=1");
    expect(serialiseUrlSelection({ tab: "library", workspace: "not valid" }, "")).toBe("?tab=library");
  });
  it("round-trips", () => {
    const s = serialiseUrlSelection({ tab: "simulation", workspace: "ws-9f" });
    expect(parseUrlSelection(s)).toMatchObject({ tab: "simulation", workspace: "ws-9f" });
  });
});

describe("bootstrap resolution", () => {
  const ids = ["ws-a", "ws-b", "ws-c"];
  it("prefers URL, then server active, then first, then null", () => {
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: "ws-c", workspaceIds: ids, serverActiveId: "ws-b" })).toMatchObject({ workspaceId: "ws-c", source: "url" });
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: "ws-zz", workspaceIds: ids, serverActiveId: "ws-b" })).toMatchObject({ workspaceId: "ws-b", source: "server-active", urlWorkspaceMissing: true });
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: null, workspaceIds: ids, serverActiveId: null })).toMatchObject({ workspaceId: "ws-a", source: "first" });
    expect(resolveBootstrapWorkspace({ urlWorkspaceId: "ws-a", workspaceIds: [], serverActiveId: null })).toMatchObject({ workspaceId: null, source: "none" });
  });
});

describe("history mode", () => {
  it("push for user changes, replace for bootstrap/correction, none when identical", () => {
    expect(decideHistoryMode({ currentSearch: "?tab=editor", nextSearch: "?tab=library", reason: "user" })).toBe("push");
    expect(decideHistoryMode({ currentSearch: "", nextSearch: "?tab=editor", reason: "bootstrap" })).toBe("replace");
    expect(decideHistoryMode({ currentSearch: "?workspace=ws-a&tab=editor", nextSearch: "?tab=editor&workspace=ws-a", reason: "user" })).toBe("none");
  });
});

describe("race guard", () => {
  it("latest wins (A -> B -> A)", () => {
    const g = createLatestGate();
    const a1 = g.begin();
    const b = g.begin();
    const a2 = g.begin();
    expect([g.isCurrent(a1), g.isCurrent(b), g.isCurrent(a2)]).toEqual([false, false, true]);
    g.invalidate();
    expect(g.isCurrent(a2)).toBe(false);
  });
  it("never shows data of another workspace", () => {
    expect(onlyIfActive("ws-a", { workspace_id: "ws-b" })).toBeUndefined();
    expect(onlyIfActive("ws-a", { workspace_id: "ws-a" })).toEqual({ workspace_id: "ws-a" });
    expect(onlyIfActive(null, { workspace_id: "ws-a" })).toBeUndefined();
  });
  it("serial queue preserves order and survives failures", async () => {
    const q = createSerialQueue();
    const order: number[] = [];
    const p1 = q.run(async () => { await new Promise((r) => setTimeout(r, 15)); order.push(1); throw new Error("x"); }).catch(() => undefined);
    const p2 = q.run(async () => { order.push(2); });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });
});
