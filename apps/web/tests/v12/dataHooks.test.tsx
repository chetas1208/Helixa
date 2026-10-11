// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installFakeFetch } from "../support/fetchFake";
import { FakeBackend, simRequest } from "../support/fakeBackend";
import { ApiError } from "../../src/v12/api/client";
import { useCommitEdit, useProposeEdit, useRunSimulation, useWorkspace, useWorkspaces } from "../../src/v12/api/hooks";

let restore = () => {};
afterEach(() => restore());

const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("data hooks against the contract (fake fetch)", () => {
  it("useWorkspaces lists server workspaces and the active one", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const { result } = renderHook(() => useWorkspaces(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.workspaces).toHaveLength(1);
    expect(result.current.data!.active?.workspace_id).toBe(f.be.workspaces[0]!.workspace_id);
  });

  it("useProposeEdit sends exactly {position, alt, note} to the selected workspace", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const id = f.be.workspaces[0]!.workspace_id;
    const { result } = renderHook(() => useProposeEdit(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ workspaceId: id, position: 4, alt: "A" });
    });
    const call = f.be.calls.find((c) => c.path.endsWith("/proposals"))!;
    expect(call.path).toBe(`/api/v10/genome/workspaces/${id}/proposals`);
    expect(call.body).toEqual({ position: 4, alt: "A", note: "" });
  });

  it("a proposal never mutates the workspace (state unchanged until commit)", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const ws = f.be.workspaces[0]!;
    const before = JSON.stringify(ws);
    const { result } = renderHook(() => useProposeEdit(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ workspaceId: ws.workspace_id, position: 4, alt: "A" });
    });
    expect(JSON.stringify(f.be.workspaces[0])).toBe(before);
    expect(f.be.calls.some((c) => c.path.endsWith("/commit"))).toBe(false);
  });

  it("useCommitEdit sends proposal_id + expected_counter and a 409 surfaces as ApiError(409) without retry", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const id = f.be.workspaces[0]!.workspace_id;
    const prop = renderHook(() => useProposeEdit(), { wrapper: wrapper() });
    let pid = "";
    await act(async () => {
      pid = (await prop.result.current.mutateAsync({ workspaceId: id, position: 4, alt: "A" })).proposal_id;
    });
    const commit = renderHook(() => useCommitEdit(), { wrapper: wrapper() });
    await act(async () => {
      await commit.result.current.mutateAsync({ workspaceId: id, proposalId: pid, expectedCounter: 1 });
    });
    const sent = f.be.calls.filter((c) => c.path.endsWith("/commit"));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ proposal_id: pid, expected_counter: 1 });
    // stale commit
    let err: unknown;
    await act(async () => {
      try {
        await commit.result.current.mutateAsync({ workspaceId: id, proposalId: pid, expectedCounter: 1 });
      } catch (e) {
        err = e;
      }
    });
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).detail).toBe("revision_counter is 2, not 1");
    expect(f.be.calls.filter((c) => c.path.endsWith("/commit"))).toHaveLength(2); // exactly one more attempt: no silent retry
  });

  it("useRunSimulation forwards the Idempotency-Key header and the 25 y/gen 409 text is surfaced verbatim", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const id = f.be.workspaces[0]!.workspace_id;
    const { result } = renderHook(() => useRunSimulation(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.mutateAsync({ request: simRequest({ workspace_id: id }) as never, idempotencyKey: "scn-1" });
    });
    expect(f.be.calls.find((c) => c.path.endsWith("/simulations"))!.headers["idempotency-key"]).toBe("scn-1");
    let err: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync({ request: simRequest({ workspace_id: id, generation_time_years: 25 }) as never });
      } catch (e) {
        err = e;
      }
    });
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).detail).toMatch(/budget is 2000 generations/);
  });

  it("network failure becomes ApiError(0) and is flagged unavailable; 404 is a missing record, not an unavailable endpoint", async () => {
    const f = installFakeFetch(new FakeBackend({ down: true }));
    restore = f.restore;
    const { result } = renderHook(() => useWorkspaces(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const e = result.current.error as ApiError;
    expect(e.status).toBe(0);
    expect(e.unavailable).toBe(true);
    expect(new ApiError(404, "x", "/p").unavailable).toBe(false);
    expect(new ApiError(405, "x", "/p").unavailable).toBe(true);
    expect(new ApiError(501, "x", "/p").unavailable).toBe(true);
  });

  it("useWorkspace(null) is disabled and issues no request", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    renderHook(() => useWorkspace(null), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 30));
    expect(f.be.calls).toHaveLength(0);
  });
});
