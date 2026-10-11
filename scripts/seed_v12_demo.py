#!/usr/bin/env python3
"""Seed a THROWAWAY DIAMOND backend with a clean, idempotent V12 demo dataset (stdlib only).

Start the API with a throwaway store first, e.g.
  MONGODB_DATABASE=diamond_v12_e V10_STATE_PATH=/tmp/v12_e_state.json .venv/bin/uvicorn services.api.app.main:app --host 127.0.0.1 --port 8303
Port 8000 is refused by default: in this workspace it is the user's live API on the REAL store (artifacts/v10/state.json).

Creates (looked up BY NAME first, so re-running never duplicates):
  (a) "Baseline (untouched)"            no edits
  (b) "Hypoxia study"                   3 committed 1-base substitutions at positions 4, 17, 31 (propose + commit,
                                         expected_counter taken from the workspace)
  (c) "Hypoxia study / variant B"       branch of (b) with one additional, different edit (position 25)
  (d) two real Wright-Fisher runs on "Hypoxia study": 2,000,000 y, 1000 y/generation, N=80, s=0.02, seeds 1 and 2
      (stable Idempotency-Key per workspace+seed; also skipped when a matching run is already listed)
  (e) selects "Hypoxia study" as the active workspace
Every substitution uses the Watson-Crick complement of the reference base so it always differs from the reference.
Only the public /api routes are used; POSTs carry Origin http://127.0.0.1:5173 (the API's allowed origin).
Usage: scripts/seed_v12_demo.py [--api http://127.0.0.1:8303] [--allow-port-8000]
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = "http://127.0.0.1:5173"
COMP = {"A": "T", "T": "A", "C": "G", "G": "C"}


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")

    def call(self, method: str, path: str, body: dict | None = None, headers: dict | None = None):
        h = {"content-type": "application/json", **(headers or {})}
        if method != "GET":
            h["Origin"] = ORIGIN
        req = urllib.request.Request(self.base + path, method=method, data=None if body is None else json.dumps(body).encode(), headers=h)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            sys.exit(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:300]}")
        except urllib.error.URLError as e:
            sys.exit(f"cannot reach {self.base}: {e.reason}. Start the API first (see --help).")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://127.0.0.1:8303")
    ap.add_argument("--allow-port-8000", action="store_true", help="seed an API on :8000 (only if it runs a throwaway store)")
    args = ap.parse_args()
    if urllib.parse.urlsplit(args.api).port == 8000 and not args.allow_port_8000:
        sys.exit("refusing to seed :8000 (the live API on the real store). Use a throwaway API port or --allow-port-8000.")
    api = Api(args.api)
    V = "/api/v10"

    window = api.call("GET", f"{V}/genome/window?start=1&end=48")["bases"]

    def find(name: str):
        return next((w for w in api.call("GET", f"{V}/genome/workspaces")["workspaces"] if w["name"] == name), None)

    def get_or_create(name: str):
        return find(name) or api.call("POST", f"{V}/genome/workspaces", {"name": name})

    def ensure_edits(wid: str, positions: list[int]) -> dict:
        ws = api.call("GET", f"{V}/genome/workspaces/{wid}")
        done = {e["position"] for e in ws["active_revision"]["edits"]}
        for pos in positions:
            if pos in done:
                continue
            alt = COMP[window[pos - 1]]
            prop = api.call("POST", f"{V}/genome/workspaces/{wid}/proposals", {"position": pos, "alt": alt, "note": "seed_v12_demo"})
            if prop["status"] != "READY":
                sys.exit(f"proposal for {wid}:{pos} was {prop['status']}: {prop.get('reason')}")
            ws = api.call("POST", f"{V}/genome/workspaces/{wid}/commit", {"proposal_id": prop["proposal_id"], "expected_counter": ws["revision_counter"]})
        return api.call("GET", f"{V}/genome/workspaces/{wid}")

    baseline = get_or_create("Baseline (untouched)")
    hypoxia = get_or_create("Hypoxia study")
    hypoxia = ensure_edits(hypoxia["workspace_id"], [4, 17, 31])

    variant = find("Hypoxia study / variant B")
    if variant is None:
        variant = api.call("POST", f"{V}/genome/workspaces/{hypoxia['workspace_id']}/branch", {"name": "Hypoxia study / variant B"})
    variant = ensure_edits(variant["workspace_id"], [4, 17, 31, 25])

    sims = []
    existing = api.call("GET", f"{V}/evolution/simulations?workspace_id={hypoxia['workspace_id']}").get("simulations", [])
    for seed in (1, 2):
        match = next((s for s in existing if s["seed"] == seed and s["genome_revision_id"] == hypoxia["active_genome_revision_id"]
                      and s["generation_time_years"] == 1000 and s["population_size"] == 80), None)
        if match is None:
            match = api.call("POST", f"{V}/evolution/simulations", {
                "workspace_id": hypoxia["workspace_id"], "horizon_years": 2_000_000, "generation_time_years": 1000,
                "population_size": 80, "initial_frequency": 0.5, "selection_coefficient": 0.02, "mutation_forward": 0,
                "migration_rate": 0, "migrant_frequency": 0, "seed": seed, "fitness_class": "USER_ASSUMED", "ploidy": 1,
            }, {"Idempotency-Key": f"seed-v12-demo-{hypoxia['workspace_id']}-{hypoxia['active_genome_revision_id']}-{seed}"})
        sims.append({"simulation_id": match["simulation_id"], "seed": seed, "result_sha256": match["result_sha256"]})

    api.call("POST", f"{V}/genome/workspaces/{hypoxia['workspace_id']}/select", {"expected_counter": None})
    out = {
        "baseline_untouched": baseline["workspace_id"],
        "hypoxia_study": hypoxia["workspace_id"],
        "hypoxia_variant_b": variant["workspace_id"],
        "hypoxia_edits": [e["position"] for e in hypoxia["active_revision"]["edits"]],
        "variant_b_edits": [e["position"] for e in variant["active_revision"]["edits"]],
        "simulations": sims,
        "active": hypoxia["workspace_id"],
        "deep_links": {t: f"/?tab={t}&workspace={hypoxia['workspace_id']}" for t in ("editor", "evolution", "simulation", "library")},
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
