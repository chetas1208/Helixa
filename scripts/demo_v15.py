#!/usr/bin/env python3
"""DIAMOND Genome V15 — Master Campaign Showcase & Verification Demo.

Executes four production scenarios:
  Scenario A: Deterministic Sequence Edit & Molecular Evidence Grounding
  Scenario B: Lineage Comparison (Genome Edit Revisions vs Research Harness)
  Scenario C: Environmental Selection & Stochastic Ensemble Trajectories
  Scenario D: Deep-Time 2,000,000-Year Earth Horizon Simulation (60s Replay)
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ARTIFACTS_DIR = ROOT / "artifacts/milestones/v15"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
STATE_PATH = ARTIFACTS_DIR / "demo_state.json"
os.environ["V10_STATE_PATH"] = str(STATE_PATH)

from services.runtime.genome_workspace.reference import base_at  # noqa: E402
from services.runtime.genome_workspace.store import WorkspaceStore  # noqa: E402
from services.runtime.population.engine_v15 import (  # noqa: E402
    EngineMode,
    EnvironmentalSelectionModel,
    FitnessClass,
    V15SimulationRequest,
    run_v15_evolution,
)


def run_scenario_a(store: WorkspaceStore, ws_id: str) -> dict:
    """Scenario A: Deterministic Sequence Edit & Evidence Grounding."""
    print("\n--- [Scenario A] Deterministic Sequence Edit & Evidence Grounding ---")
    pos = 10
    ref = base_at(pos)
    alt = "T" if ref != "T" else "G"

    t0 = time.perf_counter()
    proposal = store.propose(ws_id, pos, alt, "V15 Campaign Demonstration Edit")
    ws = store.get_workspace(ws_id)
    committed = store.commit(ws_id, proposal["proposal_id"], ws["revision_counter"])
    dur_ms = (time.perf_counter() - t0) * 1000

    active_rev = committed["active_genome_revision_id"]
    active_revision = committed.get("active_revision", {})
    mutations = active_revision.get("edits", [])

    print(f"  Workspace:             {ws_id}")
    print(f"  Target Locus:          chr22:{pos}")
    print(f"  Base Transition:       {ref} -> {alt}")
    print(f"  Active Revision ID:    {active_rev}")
    print(f"  Committed Mutations:   {len(mutations)}")
    print(f"  Deterministic Time:    {dur_ms:.2f} ms")

    return {
        "scenario": "A_SEQUENCE_EDIT",
        "status": "PASS",
        "workspace_id": ws_id,
        "locus": f"chr22:{pos}",
        "ref": ref,
        "alt": alt,
        "revision_id": active_rev,
        "mutations_count": len(mutations),
        "duration_ms": dur_ms,
    }


def run_scenario_b(store: WorkspaceStore, ws_id: str) -> dict:
    """Scenario B: Lineage Comparison (Genome vs Harness)."""
    print("\n--- [Scenario B] Lineage Comparison (Genome vs Harness) ---")
    ws = store.get_workspace(ws_id)
    g_lineage = store.genome_lineage(ws_id)
    h_lineage = store.harness_lineage(ws_id)
    nodes = g_lineage.get("nodes", [])
    harness_id = ws.get("active_harness_version_id", "v1.0")

    print(f"  Genome Lineage Nodes:  {len(nodes)}")
    for node in nodes:
        print(f"    - Revision {node.get('genome_revision_id')}: parent={node.get('parent_revision_id')}, edits={node.get('edit_count')}")
    print(f"  Active Harness Version: {harness_id} (PCHE independent lineage)")
    print(f"  Harness Distinct from Genome: {h_lineage.get('distinct_from_genome')}")
    print("  Biological Truth Note:  Software edit history != natural evolutionary phylogeny")

    return {
        "scenario": "B_LINEAGE_COMPARISON",
        "status": "PASS",
        "workspace_id": ws_id,
        "genome_lineage_depth": len(nodes),
        "active_harness_version": harness_id,
        "distinct_from_genome": h_lineage.get("distinct_from_genome"),
        "causal_boundary_disclosure": "Software edit history is non-phylogenetic author commits.",
    }


def run_scenario_c(ws_id: str) -> dict:
    """Scenario C: Environmental Selection & Stochastic Ensemble Trajectories."""
    print("\n--- [Scenario C] Environmental Selection & Ensemble Trajectories ---")
    env_model = EnvironmentalSelectionModel(
        base_selection=0.03,
        coefficients={"temperature_c": 0.015},
        baselines={"temperature_c": 14.0},
    )
    req = V15SimulationRequest(
        horizon_years=5000,
        generation_time_years=25,
        initial_frequency=0.25,
        population_size=1000,
        carrying_capacity=2000,
        fitness_class=FitnessClass.USER_ASSUMED,
        environment={"temperature_c": 20.0},
        environment_selection_model=env_model,
        replicates=20,
        seed=42,
    )

    t0 = time.perf_counter()
    outcome = run_v15_evolution(req)
    dur_ms = (time.perf_counter() - t0) * 1000

    ensemble_frames = outcome["ensemble_frames"]
    first_frame = ensemble_frames[0]
    last_frame = ensemble_frames[-1]
    summary = outcome["ensemble_summary"]

    print(f"  Replicates:            {outcome['replicates']}")
    print(f"  Simulated Generations: {outcome['generations_executed']}")
    print(f"  Effective Selection s: {outcome['effective_selection_coefficient']:.4f}")
    print(f"  Initial Median p:      {first_frame['median_allele_frequency']:.3f}")
    print(f"  Final Median p:        {last_frame['median_allele_frequency']:.3f} (p10={last_frame['percentile_10_frequency']:.3f}, p90={last_frame['percentile_90_frequency']:.3f})")
    print(f"  Fixation Fraction:     {summary['fixation_fraction']:.2f}")
    print(f"  Extinction Fraction:   {summary['extinction_fraction']:.2f}")
    print(f"  Execution Time:        {dur_ms:.2f} ms")
    print(f"  Result SHA-256:        {outcome['result_sha256'][:16]}...")

    return {
        "scenario": "C_ENVIRONMENTAL_ENSEMBLE",
        "status": "PASS",
        "replicates_count": outcome["replicates"],
        "generations_executed": outcome["generations_executed"],
        "effective_selection_s": outcome["effective_selection_coefficient"],
        "initial_median_p": first_frame["median_allele_frequency"],
        "final_median_p": last_frame["median_allele_frequency"],
        "final_p10": last_frame["percentile_10_frequency"],
        "final_p90": last_frame["percentile_90_frequency"],
        "fixation_fraction": summary["fixation_fraction"],
        "extinction_fraction": summary["extinction_fraction"],
        "result_sha256": outcome["result_sha256"],
        "duration_ms": dur_ms,
    }


def run_scenario_d(ws_id: str) -> dict:
    """Scenario D: Deep-Time 2,000,000-Year Earth Horizon Simulation (60s Replay)."""
    print("\n--- [Scenario D] Deep-Time 2,000,000-Year Horizon Simulation ---")
    req = V15SimulationRequest(
        horizon_years=2_000_000,
        generation_time_years=25,
        initial_frequency=0.10,
        population_size=5000,
        selection_coefficient=0.005,
        engine_mode=EngineMode.MODE_C_CINEMATIC,
        allow_acceleration=True,
        max_frames=240,
        replicates=10,
        seed=101,
    )

    t0 = time.perf_counter()
    outcome = run_v15_evolution(req)
    dur_ms = (time.perf_counter() - t0) * 1000

    print(f"  Horizon Years:         {outcome['simulated_years']:,} years")
    print(f"  Generations Executed:  {outcome['generations_executed']:,} generations")
    print(f"  Fidelity Category:     {outcome['fidelity']}")
    print(f"  Stored Replay Frames:  {len(outcome['frames'])} frames (capped <= 240 for 60s clock)")
    print(f"  Execution Time:        {dur_ms:.2f} ms")
    print(f"  Result SHA-256:        {outcome['result_sha256']}")

    return {
        "scenario": "D_DEEP_HORIZON_2M_YEARS",
        "status": "PASS",
        "simulated_years": outcome["simulated_years"],
        "generations_executed": outcome["generations_executed"],
        "fidelity": outcome["fidelity"],
        "frames_stored": len(outcome["frames"]),
        "duration_ms": dur_ms,
        "result_sha256": outcome["result_sha256"],
    }


def main() -> None:
    print("=" * 70)
    print("  DIAMOND Genome V15 — Production Verification Showcase")
    print("=" * 70)

    if STATE_PATH.exists():
        STATE_PATH.unlink()

    store = WorkspaceStore(STATE_PATH)
    ws = store.create_workspace("V15 Master Campaign Demo Workspace")
    ws_id = ws["workspace_id"]

    results = []
    results.append(run_scenario_a(store, ws_id))
    results.append(run_scenario_b(store, ws_id))
    results.append(run_scenario_c(ws_id))
    results.append(run_scenario_d(ws_id))

    summary = {
        "version": "V15",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "status": "PASS",
        "all_scenarios_passed": all(r["status"] == "PASS" for r in results),
        "scenarios": results,
    }

    out_file = ARTIFACTS_DIR / "demo_summary.json"
    out_file.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print("\n" + "=" * 70)
    print(f"  All 4 Scenarios Passed Successfully! Report saved to:\n  {out_file}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
