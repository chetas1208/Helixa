// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installFakeFetch } from "../../../tests/support/fetchFake";
import { FakeBackend } from "../../../tests/support/fakeBackend";
import { useSession } from "../state/session";
import { useGuardedWorkspaceSwitch } from "./SwitchGuard";

let restore = () => {};
afterEach(() => restore());

function setup() {
  // The fake applies `select` when the request arrives and only then waits, like a server that already acted on a request the client later gave up on.
  const be = new FakeBackend({ empty: true, delayMs: 40 });
  const a = be.createWorkspace("A");
  const b = be.createWorkspace("B");
  const c = be.createWorkspace("C");
  be.activeId = a.workspace_id;
  const f = installFakeFetch(be);
  restore = f.restore;
  useSession.setState({ activeWorkspaceId: a.workspace_id, drafts: {} });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useGuardedWorkspaceSwitch(), { wrapper });
  const selects = () => be.calls.filter((x) => x.method === "POST" && x.path.endsWith("/select")).map((x) => x.path.split("/")[5]);
  return { be, a: a.workspace_id, b: b.workspace_id, c: c.workspace_id, sw: result.current, selects };
}

describe("useGuardedWorkspaceSwitch: latest intent wins on client and server", () => {
  it("A -> B -> A while B is in flight ends on A everywhere", async () => {
    const { be, a, b, sw, selects } = setup();
    let r: boolean[] = [];
    await act(async () => {
      const toB = sw(b);
      await new Promise((res) => setTimeout(res, 50)); // B's select has reached the server
      r = await Promise.all([toB, sw(a)]);
    });
    expect(r).toEqual([false, true]);
    expect(useSession.getState().activeWorkspaceId).toBe(a);
    expect(be.activeId).toBe(a);
    expect(selects()).toEqual([b, a]);
  });

  it("A -> B -> C -> A rapid clicks end on A and never apply an older select", async () => {
    const { be, a, b, c, sw, selects } = setup();
    let r: boolean[] = [];
    await act(async () => {
      r = await Promise.all([sw(b), sw(c), sw(a)]);
    });
    expect(r).toEqual([false, false, true]);
    expect(useSession.getState().activeWorkspaceId).toBe(a);
    expect(be.activeId).toBe(a);
    expect(selects().at(-1)).toBe(a);
  });

  it("re-selecting the active workspace with nothing in flight sends no request", async () => {
    const { a, sw, selects } = setup();
    let r = false;
    await act(async () => {
      r = await sw(a);
    });
    expect(r).toBe(true);
    expect(selects()).toEqual([]);
  });
});
