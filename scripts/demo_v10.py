"""Run one honest V10 population demo and print the result hash."""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("V10_STATE_PATH", str(ROOT / "artifacts/v10/demo_state.json"))

from services.runtime.genome_workspace.reference import base_at  # noqa: E402
from services.runtime.genome_workspace.store import WorkspaceStore  # noqa: E402


def main() -> None:
    path = Path(os.environ["V10_STATE_PATH"])
    if path.exists():
        path.unlink()
    store = WorkspaceStore(path)
    workspace = store.create_workspace("V10 demo")
    position = 4
    ref = base_at(position)
    alt = "A" if ref != "A" else "C"
    proposal = store.propose(workspace["workspace_id"], position, alt, "illustrative")
    committed = store.commit(workspace["workspace_id"], proposal["proposal_id"], workspace["revision_counter"])
    simulation = store.simulate(
        {
            "workspace_id": committed["workspace_id"],
            "horizon_years": 2000,
            "generation_time_years": 25,
            "population_size": 80,
            "initial_frequency": 0.5,
            "selection_coefficient": 0.15,
            "fitness_class": "EDUCATIONAL_TOY",
            "temperature_c": 12,
            "seed": 1,
        },
        "demo-v10",
    )
    print(f"workspace {committed['workspace_id']}")
    print(f"genome_revision {committed['active_genome_revision_id']}")
    print(f"harness {committed['active_harness_version_id']}")
    print(f"simulation {simulation['simulation_id']}")
    print(f"years {simulation['simulated_years']} generations {simulation['generations_executed']}")
    print(f"result_sha256 {simulation['result_sha256']}")
    print(simulation["narrative"])


if __name__ == "__main__":
    main()
