// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { installFakeFetch } from "../support/fetchFake";
import { FakeBackend } from "../support/fakeBackend";
import { useHarnessLineage, useTranscriptionAvailability, useWorkspaceCapabilities } from "../../src/v12/api/hooks";

/** Spec 16: a missing endpoint or unconfigured provider is shown as such, never as a fake success. */
let restore = () => {};
afterEach(() => restore());
const wrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("voice transcription: the backend answers HTTP 501 NOT_CONFIGURED", () => {
  it("501 from /api/voice/transcribe => unavailable with a 'not configured' reason (no transcript invented)", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const { result } = renderHook(() => useTranscriptionAvailability(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ available: false, reason: expect.stringMatching(/not configured/i) });
    const probe = f.be.calls.find((c) => c.path === "/api/voice/transcribe")!;
    expect(probe.status).toBe(501);
    expect(probe.body, "the probe carries no audio").toEqual({});
  });

  it("API down => 'unreachable, status unknown', never 'available'", async () => {
    const f = installFakeFetch(new FakeBackend({ down: true }));
    restore = f.restore;
    const { result } = renderHook(() => useTranscriptionAvailability(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ available: false, reason: expect.stringMatching(/unreachable/i) });
  });

  it("a real endpoint that rejects the empty probe (422) is detected as present", async () => {
    const f = installFakeFetch(new FakeBackend({ forced: [{ match: /^\/api\/voice\/transcribe$/, status: 422, json: { detail: "audio required" } }] }));
    restore = f.restore;
    const { result } = renderHook(() => useTranscriptionAvailability(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.available).toBe(true);
  });
});

describe("optional routes and missing records", () => {
  it("backend without rename/archive/list routes => all capabilities false (actions stay disabled)", async () => {
    const f = installFakeFetch(new FakeBackend({ noOptionalRoutes: true }));
    restore = f.restore;
    const { result } = renderHook(() => useWorkspaceCapabilities(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ rename: false, archive: false, listSimulations: false });
  });

  it("backend with the routes => capabilities true, and the probes have no side effects", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const before = JSON.stringify(f.be.workspaces);
    const { result } = renderHook(() => useWorkspaceCapabilities(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ rename: true, archive: true, listSimulations: true });
    expect(JSON.stringify(f.be.workspaces)).toBe(before);
  });

  it("harness lineage 404 is 'no lineage recorded', not an error and not invented", async () => {
    const f = installFakeFetch();
    restore = f.restore;
    const { result } = renderHook(() => useHarnessLineage("hv-unknown"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ recorded: false, reason: expect.stringMatching(/no lineage recorded/i) });
  });
});
