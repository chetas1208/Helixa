import { describe, it, expect } from "vitest";
import { FakeBackend, FAKE_BASELINE_48, simRequest } from "../support/fakeBackend";

/** The fake is the foundation of every MOCKED pass: pin its behaviour to what the real service was observed to do. */
describe("FakeBackend mirrors the observed /api/v10 behaviour", () => {
  const V = "/api/v10/genome";
  it("seeds one workspace with the synthetic chr22 baseline", () => {
    const be = new FakeBackend();
    const r = be.handle("GET", `${V}/workspaces`);
    const j = r.json as { workspaces: { active_revision: { preview_1_48: string } }[] };
    expect(j.workspaces).toHaveLength(1);
    expect(j.workspaces[0]!.active_revision.preview_1_48).toBe(FAKE_BASELINE_48);
  });

  it("proposal -> commit changes base 4 T->A and bumps the counter", () => {
    const be = new FakeBackend();
    const ws = be.workspaces[0]!;
    const p = be.handle("POST", `${V}/workspaces/${ws.workspace_id}/proposals`, { position: 4, alt: "A", note: "" }).json as { proposal_id: string; status: string; ref: string };
    expect(p.status).toBe("READY");
    expect(p.ref).toBe("T");
    const c = be.handle("POST", `${V}/workspaces/${ws.workspace_id}/commit`, { proposal_id: p.proposal_id, expected_counter: 1 });
    expect(c.status).toBe(200);
    const w = c.json as { revision_counter: number; active_revision: { preview_1_48: string } };
    expect(w.revision_counter).toBe(2);
    expect(w.active_revision.preview_1_48).toBe("ACGAGCAGTGTAGCTAGCTAGCTGATCGATCGTAGCTAGCTAGCTGAC");
  });

  it("stale expected_counter -> 409 with the backend text", () => {
    const be = new FakeBackend();
    const id = be.workspaces[0]!.workspace_id;
    const p = be.handle("POST", `${V}/workspaces/${id}/proposals`, { position: 4, alt: "A" }).json as { proposal_id: string };
    be.handle("POST", `${V}/workspaces/${id}/commit`, { proposal_id: p.proposal_id, expected_counter: 1 });
    const again = be.handle("POST", `${V}/workspaces/${id}/commit`, { proposal_id: p.proposal_id, expected_counter: 1 });
    expect(again.status).toBe(409);
    expect((again.json as { detail: string }).detail).toBe("revision_counter is 2, not 1");
  });

  it("invalid alt -> 400, out of range -> 400, position 0 -> 422", () => {
    const be = new FakeBackend();
    const id = be.workspaces[0]!.workspace_id;
    expect(be.handle("POST", `${V}/workspaces/${id}/proposals`, { position: 4, alt: "Z" }).status).toBe(400);
    expect(be.handle("POST", `${V}/workspaces/${id}/proposals`, { position: 999_999_999, alt: "A" }).status).toBe(400);
    expect(be.handle("POST", `${V}/workspaces/${id}/proposals`, { position: 0, alt: "A" }).status).toBe(422);
  });

  it("simulation at 25 y/gen over 2M years is a 409 budget error; 1000 y/gen succeeds with 2000 generations", () => {
    const be = new FakeBackend();
    const id = be.workspaces[0]!.workspace_id;
    const bad = be.handle("POST", "/api/v10/evolution/simulations", simRequest({ workspace_id: id, generation_time_years: 25 }));
    expect(bad.status).toBe(409);
    expect((bad.json as { detail: string }).detail).toMatch(/budget is 2000 generations/);
    const ok = be.handle("POST", "/api/v10/evolution/simulations", simRequest({ workspace_id: id }));
    expect(ok.status).toBe(200);
    const sim = ok.json as { generations_executed: number; frames: { generation: number }[]; workspace_id: string };
    expect(sim.generations_executed).toBe(2000);
    expect(sim.frames[0]!.generation).toBe(0);
    expect(sim.frames.at(-1)!.generation).toBe(2000);
    expect(sim.workspace_id).toBe(id);
  });

  it("different seeds give different trajectories; same seed + idempotency key is replayed", () => {
    const be = new FakeBackend();
    const id = be.workspaces[0]!.workspace_id;
    const a = be.handle("POST", "/api/v10/evolution/simulations", simRequest({ workspace_id: id, seed: 1 }), { "idempotency-key": "k" }).json as { simulation_id: string; result_sha256: string };
    const a2 = be.handle("POST", "/api/v10/evolution/simulations", simRequest({ workspace_id: id, seed: 1 }), { "idempotency-key": "k" }).json as { simulation_id: string };
    const b = be.handle("POST", "/api/v10/evolution/simulations", simRequest({ workspace_id: id, seed: 2 })).json as { result_sha256: string };
    expect(a2.simulation_id).toBe(a.simulation_id);
    expect(b.result_sha256).not.toBe(a.result_sha256);
  });

  it("fault injection: down aborts, forced statuses apply N times", () => {
    const be = new FakeBackend({ down: true });
    expect(be.handle("GET", "/api/health").abort).toBe(true);
    const be2 = new FakeBackend({ forced: [{ match: /workspaces$/, status: 503, json: { detail: "x" }, times: 1 }] });
    expect(be2.handle("GET", "/api/v10/genome/workspaces").status).toBe(503);
    expect(be2.handle("GET", "/api/v10/genome/workspaces").status).toBe(200);
  });
});
