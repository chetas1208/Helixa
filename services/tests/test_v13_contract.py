"""V13 contract: selection, text proposals, playback clock, and voice status."""

from fastapi.testclient import TestClient

from services.runtime.genome_workspace.reference import base_at
from services.runtime.genome_workspace.store import WorkspaceStore


def test_selecting_b_then_a_changes_the_snapshot(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    first = store.create_workspace("alpha")
    ref = base_at(6)
    alt = "A" if ref != "A" else "T"
    proposal = store.propose(first["workspace_id"], 6, alt, "")
    edited = store.commit(first["workspace_id"], proposal["proposal_id"], first["revision_counter"])
    second = store.create_workspace("beta")
    store.select(second["workspace_id"], second["revision_counter"])
    snap_b = store.snapshot()
    assert snap_b["workspace"]["workspace_id"] == second["workspace_id"]
    assert snap_b["genome_revision_id"] == second["active_genome_revision_id"]
    assert snap_b["body"]["effect_class"] == "ILLUSTRATIVE"
    assert snap_b["body"]["anatomy_changed"] is False
    store.select(edited["workspace_id"], edited["revision_counter"])
    snap_a = store.snapshot()
    assert snap_a["selection_version"] == snap_b["selection_version"] + 1
    assert snap_a["workspace"]["edit_count"] == 1
    assert snap_a["genome_revision_id"] != snap_b["genome_revision_id"]
    genome = store.genome_lineage(edited["workspace_id"])
    harness = store.harness_lineage(edited["workspace_id"])
    assert genome["kind"] == "GENOME_REVISION"
    assert harness["kind"] == "ANALYSIS_HARNESS"
    assert harness["distinct_from_genome"] is True
    assert {node["genome_revision_id"] for node in genome["nodes"]}.isdisjoint(
        {node["harness_version_id"] for node in harness["nodes"]}
    )


def test_text_instruction_rejects_a_wrong_reference_base(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    workspace = store.create_workspace("prompt")
    actual = base_at(6)
    wrong = "A" if actual != "A" else "C"
    rejected = store.interpret(workspace["workspace_id"], f"change position 6 from {wrong} to T")
    assert rejected["status"] == "REJECTED"
    vague = store.interpret(workspace["workspace_id"], "make it better")
    assert vague["status"] == "NEEDS_CLARIFICATION"
    ready = store.interpret(workspace["workspace_id"], f"change position 6 from {actual} to {wrong}")
    assert ready["status"] == "READY"
    assert ready["proposals"][0]["applied"] is False


def test_repeat_commit_key_does_not_apply_twice(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    workspace = store.create_workspace("once")
    ref = base_at(9)
    alt = "G" if ref != "G" else "C"
    proposal = store.propose(workspace["workspace_id"], 9, alt, "")
    first = store.commit(workspace["workspace_id"], proposal["proposal_id"], workspace["revision_counter"], "same-key")
    second = store.commit(workspace["workspace_id"], proposal["proposal_id"], first["revision_counter"], "same-key")
    assert second["revision_counter"] == first["revision_counter"]
    assert second["edit_count"] == 1


def test_playback_duration_does_not_change_the_science(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    workspace = store.create_workspace("clock")
    run = store.simulate(
        {
            "workspace_id": workspace["workspace_id"],
            "horizon_years": 200,
            "generation_time_years": 25,
            "population_size": 12,
            "ploidy": 2,
            "seed": 3,
            "fitness_class": "EDUCATIONAL_TOY",
        },
        None,
    )
    short = store.playback(run["simulation_id"], 60)
    long = store.playback(run["simulation_id"], 120)
    assert short["duration_seconds"] == 60
    assert long["duration_seconds"] == 120
    assert short["result_sha256"] == long["result_sha256"]
    assert short["frames"] == long["frames"]
    listed = store.list_simulations(workspace["workspace_id"])
    assert [item["simulation_id"] for item in listed] == [run["simulation_id"]]


def test_archived_workspace_cannot_be_selected(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    workspace = store.create_workspace("old")
    store.archive(workspace["workspace_id"])
    try:
        store.select(workspace["workspace_id"], None)
        raised = False
    except ValueError:
        raised = True
    assert raised is True


def test_transcribe_route_does_not_invent_a_transcript():
    import os

    from services.api.app.main import app

    client = TestClient(app)
    response = client.post("/api/voice/transcribe", json={})
    configured = os.getenv("ELEVENLABS_ENABLED", "").lower() == "true" and bool(os.getenv("ELEVENLABS_API_KEY"))
    if configured:
        assert response.status_code == 422
        assert "transcript" not in response.json()
    else:
        assert response.status_code == 501
        assert response.json()["status"] == "NOT_CONFIGURED"
        assert response.json()["transcript"] is None
