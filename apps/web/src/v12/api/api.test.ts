import { describe, expect, it } from "vitest";
import { ApiError, CONTRACT_MISMATCH_DETAIL, apiGetParsed, shouldRetryRequest, withTimeout } from "./client";
import { connectionFromHealth } from "./connection";
import { routeExists } from "./capabilities";
import { isStaleKeyForWorkspace, qk, workspaceIdFromKey } from "./queryKeys";
import { SimulationSchema, WorkspaceListSchema } from "./schemas";
import { SIM_MEMORY_LIMIT, addSimulationId, parseSimulationIds, recallSimulations, rememberSimulation } from "./simMemory";
import type { KeyValueStorage } from "./simMemory";

const rev = { genome_revision_id: "rev-a", parent_revision_id: null, edits: [], preview_1_48: "ACGT", sequence_sha256: "x", harness_version_id: "h", created_at: "t" };
const ws = {
  workspace_id: "ws-abc", name: "n", reference_asset_id: "r", assembly: "a", official_grch38: false, active_genome_revision_id: "rev-a",
  active_harness_version_id: "h", revision_counter: 1, edit_count: 0, active_revision: rev, status: "ACTIVE", updated_at: "t",
};

function memStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("schemas", () => {
  it("tolerates extra fields", () => {
    expect(WorkspaceListSchema.safeParse({ workspaces: [{ ...ws, surprise: 1 }], active: null }).success).toBe(true);
  });
  it("rejects missing/mistyped required fields", () => {
    expect(WorkspaceListSchema.safeParse({ workspaces: [{ ...ws, edit_count: "0" }], active: null }).success).toBe(false);
    expect(SimulationSchema.safeParse({}).success).toBe(false);
  });
});

describe("client", () => {
  it("raises a 502-like contract error when the body fails validation", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ workspaces: "nope" }), { status: 200 })) as typeof fetch;
    try {
      await expect(apiGetParsed("/api/x", WorkspaceListSchema)).rejects.toMatchObject({ status: 502, detail: CONTRACT_MISMATCH_DETAIL });
    } finally {
      globalThis.fetch = orig;
    }
  });
  it("surfaces 409 detail and never retries 4xx", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ detail: "revision_counter is 3, not 2" }), { status: 409 })) as typeof fetch;
    try {
      const err = await apiGetParsed("/api/x", WorkspaceListSchema).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).conflict).toBe(true);
      expect((err as ApiError).detail).toBe("revision_counter is 3, not 2");
      expect(shouldRetryRequest(0, err)).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });
  it("retries only network/5xx, at most twice", () => {
    expect(shouldRetryRequest(0, new ApiError(0, "net", "/x"))).toBe(true);
    expect(shouldRetryRequest(1, new ApiError(503, "x", "/x"))).toBe(true);
    expect(shouldRetryRequest(2, new ApiError(503, "x", "/x"))).toBe(false);
    expect(shouldRetryRequest(0, new ApiError(404, "x", "/x"))).toBe(false);
    expect(shouldRetryRequest(0, new ApiError(502, CONTRACT_MISMATCH_DETAIL, "/x"))).toBe(false);
  });
  it("aborting the caller signal rejects with AbortError", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = ((_u: string, init?: RequestInit) =>
      new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))) as typeof fetch;
    try {
      const c = new AbortController();
      const p = apiGetParsed("/api/x", WorkspaceListSchema, c.signal);
      c.abort();
      await expect(p).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      globalThis.fetch = orig;
    }
  });
  it("withTimeout aborts and reports timeout", async () => {
    const t = withTimeout(undefined, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(true);
    t.dispose();
  });
});

describe("query keys", () => {
  it("scopes per-workspace keys by workspace id", () => {
    expect(qk.workspace("ws-a")).not.toEqual(qk.workspace("ws-b"));
    expect(workspaceIdFromKey(qk.workspace("ws-a"))).toBe("ws-a");
    expect(workspaceIdFromKey(qk.intelligence("ws-a", "rev"))).toBe("ws-a");
    expect(workspaceIdFromKey(qk.simulation("sim-1", "ws-a"))).toBe("ws-a");
    expect(workspaceIdFromKey(qk.simulation("sim-1"))).toBeNull();
    expect(workspaceIdFromKey(qk.workspaces)).toBeNull();
  });
  it("flags only other workspaces' keys as stale", () => {
    expect(isStaleKeyForWorkspace(qk.workspace("ws-a"), "ws-b")).toBe(true);
    expect(isStaleKeyForWorkspace(qk.workspace("ws-b"), "ws-b")).toBe(false);
    expect(isStaleKeyForWorkspace(qk.workspaces, "ws-b")).toBe(false);
    expect(isStaleKeyForWorkspace(qk.reference, "ws-b")).toBe(false);
  });
});

describe("simulation memory", () => {
  it("safe-parses garbage", () => {
    expect(parseSimulationIds("{not json")).toEqual([]);
    expect(parseSimulationIds('{"a":1}')).toEqual([]);
    expect(parseSimulationIds('["sim-ok", 5, "<script>", "sim-ok", "sim-two"]')).toEqual(["sim-ok", "sim-two"]);
    expect(parseSimulationIds(null)).toEqual([]);
  });
  it("remembers newest first, dedupes, caps", () => {
    const s = memStorage();
    rememberSimulation("ws-a", "sim-1", s);
    rememberSimulation("ws-a", "sim-2", s);
    expect(rememberSimulation("ws-a", "sim-1", s)).toEqual(["sim-1", "sim-2"]);
    expect(recallSimulations("ws-a", s)).toEqual(["sim-1", "sim-2"]);
    expect(recallSimulations("ws-b", s)).toEqual([]);
    let l: string[] = [];
    for (let i = 0; i < SIM_MEMORY_LIMIT + 5; i++) l = addSimulationId(l, `sim-${i}`);
    expect(l).toHaveLength(SIM_MEMORY_LIMIT);
  });
  it("rejects bad ids and survives a throwing storage", () => {
    const bad: KeyValueStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(recallSimulations("ws-a", bad)).toEqual([]);
    expect(rememberSimulation("ws-a", "sim-1", bad)).toEqual(["sim-1"]);
    expect(rememberSimulation("../evil", "sim-1", memStorage())).toEqual([]);
    expect(rememberSimulation("ws-a", "not-a-sim", memStorage())).toEqual([]);
  });
});

describe("connectionFromHealth", () => {
  it("maps outcomes honestly", () => {
    expect(connectionFromHealth({ data: { status: "HEALTHY" } })).toBe("online");
    expect(connectionFromHealth({ data: { status: "DEGRADED" } })).toBe("degraded");
    expect(connectionFromHealth({ error: new ApiError(0, "net", "/api/health") })).toBe("offline");
    expect(connectionFromHealth({ error: new ApiError(500, "x", "/api/health") })).toBe("degraded");
    expect(connectionFromHealth({ error: new Error("?") })).toBe("unknown");
  });
});

describe("capability probe classification", () => {
  it("distinguishes a missing route from an unknown workspace", () => {
    expect(routeExists("archive", { status: 404, detail: "Not Found" })).toBe(false);
    expect(routeExists("archive", { status: 404, detail: "'ws-capability-probe'" })).toBe(true);
    expect(routeExists("rename", { status: 405, detail: "Method Not Allowed" })).toBe(false);
    expect(routeExists("listSimulations", { status: 422, detail: "[]" })).toBe(true);
    expect(routeExists("rename", { status: 0, detail: "net" })).toBe(false);
    expect(routeExists("rename", { status: 500, detail: "boom" })).toBe(false);
  });
});
