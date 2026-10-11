"""Workspace draft/commit isolation and the active pointer."""

import pytest

from services.runtime.genome_workspace.reference import base_at, window
from services.runtime.genome_workspace.store import WorkspaceConflict, WorkspaceStore


@pytest.fixture
def store(tmp_path):
    return WorkspaceStore(path=tmp_path / "state.json")


def test_commit_changes_a_revision_and_leaves_the_baseline_preview(store: WorkspaceStore):
    workspace = store.create_workspace("locus trial")
    position = 4
    ref = base_at(position)
    alt = "A" if ref != "A" else "C"
    proposal = store.propose(workspace["workspace_id"], position, alt, "illustrative base")
    assert proposal["status"] == "READY"
    assert proposal["ref"] == ref
    committed = store.commit(workspace["workspace_id"], proposal["proposal_id"], workspace["revision_counter"])
    assert committed["edit_count"] == 1
    assert committed["active_revision"]["preview_1_48"][position - 1] == alt
    assert committed["active_revision"]["preview_1_48"] != window(1, 48)
    assert committed["active_harness_version_id"] != committed["active_genome_revision_id"]
    baseline = window(1, 48)
    assert baseline[position - 1] == ref


def test_stale_counter_does_not_overwrite(store: WorkspaceStore):
    workspace = store.create_workspace("race")
    position = 6
    ref = base_at(position)
    alt = "G" if ref != "G" else "T"
    proposal = store.propose(workspace["workspace_id"], position, alt, "")
    with pytest.raises(WorkspaceConflict):
        store.commit(workspace["workspace_id"], proposal["proposal_id"], expected_counter=999)


def test_selecting_a_branch_is_the_active_pointer(store: WorkspaceStore):
    first = store.create_workspace("alpha")
    second = store.branch(first["workspace_id"], "alpha branch")
    selected = store.select(second["workspace_id"], second["revision_counter"])
    assert store.active()["workspace_id"] == selected["workspace_id"]
    assert store.get_workspace(first["workspace_id"])["workspace_id"] == first["workspace_id"]


def test_mismatched_alt_equal_to_current_is_rejected(store: WorkspaceStore):
    workspace = store.create_workspace("noop")
    ref = base_at(2)
    proposal = store.propose(workspace["workspace_id"], 2, ref, "")
    assert proposal["status"] == "REJECTED"


def test_budgeted_run_records_frames_and_a_second_seed_can_differ(store: WorkspaceStore):
    workspace = store.create_workspace("sandbox")
    body = {
        "workspace_id": workspace["workspace_id"],
        "horizon_years": 500,
        "generation_time_years": 25,
        "population_size": 40,
        "initial_frequency": 0.5,
        "selection_coefficient": 0.0,
        "fitness_class": "EDUCATIONAL_TOY",
        "temperature_c": 30,
        "seed": 11,
    }
    first = store.simulate(body, "job-1")
    replay = store.simulate(body, "job-1")
    assert replay["simulation_id"] == first["simulation_id"]
    assert first["frames"][-1]["generation"] == 20
    assert first["environment_effects"]["temperature_c"] == "NOT_MODELED"
    assert "not a prediction" in first["narrative"]
    other = store.simulate({**body, "seed": 12}, None)
    assert other["result_sha256"] != first["result_sha256"]
