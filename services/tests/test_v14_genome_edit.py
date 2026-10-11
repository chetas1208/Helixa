"""V14 genome-edit grammar, proposals, apply, lineage, and sponsor honesty."""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.api.app.routes import genome_edit, voice
from services.integrations.raindrop import RaindropAdapter
from services.runtime.genome_edit.parser import interpret_command
from services.runtime.genome_workspace.reference import ASSET_ID, base_at
from services.runtime.genome_workspace.store import WorkspaceConflict, WorkspaceStore


@pytest.fixture
def store(tmp_path):
    return WorkspaceStore(path=tmp_path / "state.json")


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(genome_edit, "_store", WorkspaceStore(tmp_path / "state.json"))
    app = FastAPI()
    app.include_router(genome_edit.router)
    app.include_router(voice.router)
    return TestClient(app)


def _ready_alt(position: int = 6) -> tuple[str, str]:
    ref = base_at(position)
    alt = "A" if ref != "A" else "T"
    return ref, alt


def test_trait_goal_never_creates_a_proposal(store: WorkspaceStore):
    workspace = store.create_workspace("traits")
    before = store.path.read_text(encoding="utf-8")
    parsed = interpret_command({"text": "change my eye colour", "source": "text"})
    assert parsed["intent"] == "TRAIT_GOAL"
    assert parsed["edit"] is None
    assert parsed["parser"] == "deterministic-v14"
    assert "proposal" not in json.dumps(parsed).lower() or parsed["trait_goal"]
    stronger = interpret_command({"text": "I want stronger legs", "source": "text"})
    assert stronger["intent"] == "TRAIT_GOAL"
    assert stronger["edit"] is None
    cold = interpret_command({"text": "help me survive extreme cold", "source": "voice"})
    assert cold["intent"] == "TRAIT_GOAL"
    after = json.loads(store.path.read_text(encoding="utf-8")) if store.path.exists() else {}
    assert after.get("genome_edit_proposals", {}) == {}
    assert after.get("proposals", {}) == {}
    assert json.loads(before)["workspaces"][workspace["workspace_id"]]["revision_counter"] == 1


def test_stated_ref_mismatch_needs_clarification_with_actual_base():
    actual = base_at(6)
    wrong = "A" if actual != "A" else "C"
    parsed = interpret_command({"text": f"change position 6 from {wrong} to T", "source": "text"})
    assert parsed["intent"] == "NEEDS_CLARIFICATION"
    assert parsed["edit"]["actual_ref"] == actual
    assert actual in parsed["reason"]
    assert wrong in parsed["reason"]
    assert parsed["edit"]["alt"] == "T"


def test_precise_edit_does_not_write_a_proposal(store: WorkspaceStore):
    store.create_workspace("parse-only")
    actual = base_at(6)
    alt = "A" if actual != "A" else "T"
    parsed = interpret_command({"text": f"change position 6 from {actual} to {alt}", "source": "text"})
    assert parsed["intent"] == "PRECISE_EDIT"
    assert parsed["edit"]["position"] == 6
    assert parsed["edit"]["alt"] == alt
    state = json.loads(store.path.read_text(encoding="utf-8"))
    assert state["genome_edit_proposals"] == {}
    assert state["workspaces"][next(iter(state["workspaces"]))]["revision_counter"] == 1


def test_ref_mismatch_rejected_on_validate(store: WorkspaceStore):
    workspace = store.create_workspace("mismatch")
    actual = base_at(8)
    wrong = "A" if actual != "A" else "C"
    alt = "G" if actual != "G" else "T"
    proposal = store.create_genome_edit_proposal(
        {
            "workspace_id": workspace["workspace_id"],
            "parent_revision_id": workspace["active_genome_revision_id"],
            "position": 8,
            "alt": alt,
            "source": "manual",
            "stated_ref": wrong,
        }
    )
    assert proposal["validation_status"] == "pending"
    validated = store.validate_genome_edit_proposal(proposal["proposal_id"])
    assert validated["validation_status"] == "invalid"
    assert any(item["check"] == "ref_matches_pinned_reference" and item["passed"] is False for item in validated["checks"])
    with pytest.raises(ValueError, match="valid"):
        store.apply_genome_edit_proposal(proposal["proposal_id"], workspace["revision_counter"])


def test_apply_409_on_stale_counter(store: WorkspaceStore):
    workspace = store.create_workspace("stale")
    ref, alt = _ready_alt(9)
    proposal = store.create_genome_edit_proposal(
        {
            "workspace_id": workspace["workspace_id"],
            "parent_revision_id": workspace["active_genome_revision_id"],
            "position": 9,
            "alt": alt,
            "source": "text",
            "stated_ref": ref,
        }
    )
    store.validate_genome_edit_proposal(proposal["proposal_id"])
    with pytest.raises(WorkspaceConflict):
        store.apply_genome_edit_proposal(proposal["proposal_id"], expected_counter=999)


def test_idempotent_apply(store: WorkspaceStore):
    workspace = store.create_workspace("once")
    ref, alt = _ready_alt(11)
    proposal = store.create_genome_edit_proposal(
        {
            "workspace_id": workspace["workspace_id"],
            "parent_revision_id": workspace["active_genome_revision_id"],
            "position": 11,
            "alt": alt,
            "source": "manual",
            "stated_ref": ref,
        }
    )
    validated = store.validate_genome_edit_proposal(proposal["proposal_id"])
    assert validated["validation_status"] == "valid"
    first = store.apply_genome_edit_proposal(proposal["proposal_id"], workspace["revision_counter"], "same-apply")
    second = store.apply_genome_edit_proposal(proposal["proposal_id"], first["workspace"]["revision_counter"], "same-apply")
    assert second["workspace"]["revision_counter"] == first["workspace"]["revision_counter"]
    assert second["workspace"]["edit_count"] == 1
    assert second["receipt"]["genome_revision_id"] == first["receipt"]["genome_revision_id"]


def test_lineage_distinct_and_edits_summary(store: WorkspaceStore):
    workspace = store.create_workspace("lineage")
    ref, alt = _ready_alt(4)
    proposal = store.create_genome_edit_proposal(
        {
            "workspace_id": workspace["workspace_id"],
            "parent_revision_id": workspace["active_genome_revision_id"],
            "position": 4,
            "alt": alt,
            "source": "manual",
            "anatomy_id": "UBERON:0000948",
            "stated_ref": ref,
        }
    )
    store.validate_genome_edit_proposal(proposal["proposal_id"])
    applied = store.apply_genome_edit_proposal(proposal["proposal_id"], workspace["revision_counter"])
    genome = store.genome_lineage(workspace["workspace_id"])
    harness = store.harness_lineage(workspace["workspace_id"])
    assert genome["kind"] == "GENOME_REVISION"
    assert harness["kind"] == "ANALYSIS_HARNESS"
    assert harness["distinct_from_genome"] is True
    assert {node["genome_revision_id"] for node in genome["nodes"]}.isdisjoint(
        {node["harness_version_id"] for node in harness["nodes"]}
    )
    summaries = [item for node in genome["nodes"] for item in node["edits_summary"]]
    assert any(item["position"] == 4 and item["alt"] == alt and "UBERON:0000948" in item["anatomy_ids"] for item in summaries)
    assert applied["workspace"]["active_harness_version_id"] != applied["workspace"]["active_genome_revision_id"]


def test_grch38_edits_do_not_collide_with_synthetic_preview(store: WorkspaceStore):
    workspace = store.create_workspace("mix")
    ref, alt = _ready_alt(6)
    syn = store.create_genome_edit_proposal(
        {
            "workspace_id": workspace["workspace_id"],
            "parent_revision_id": workspace["active_genome_revision_id"],
            "position": 6,
            "alt": alt,
            "source": "manual",
            "reference_asset_id": ASSET_ID,
            "stated_ref": ref,
        }
    )
    store.validate_genome_edit_proposal(syn["proposal_id"])
    applied = store.apply_genome_edit_proposal(syn["proposal_id"], workspace["revision_counter"])
    foreign = {
        "position": 6,
        "ref": "A",
        "alt": "C",
        "current_allele_at_commit": "A",
        "reference_asset_id": "grch38_slices_ensembl116",
        "locus_id": "grch38:MYH7:14:23412700-23412939",
        "assembly": "GRCh38",
        "contig": "14",
        "anatomy_ids": [],
    }
    revision = applied["workspace"]["active_revision"]
    mixed = [*revision["edits"], foreign]
    from services.runtime.genome_workspace.store import _edited_window, _sequence_at

    preview = _edited_window(1, 48, mixed)
    assert preview[5] == alt
    assert preview[5] != "C"
    raw = json.loads(store.path.read_text(encoding="utf-8"))
    workspace_row = raw["workspaces"][workspace["workspace_id"]]
    current = _sequence_at(workspace_row, 6, ASSET_ID)
    assert current == alt


def test_anatomy_selection_is_not_a_workspace_change(store: WorkspaceStore):
    workspace = store.create_workspace("body")
    before = store.get_workspace(workspace["workspace_id"])
    interpret_command(
        {
            "text": "focus on the heart",
            "source": "text",
            "selection": {"anatomy_id": "UBERON:0000948"},
        }
    )
    after = store.get_workspace(workspace["workspace_id"])
    assert after["revision_counter"] == before["revision_counter"]
    assert after["active_genome_revision_id"] == before["active_genome_revision_id"]
    assert after["active_revision"]["edits"] == []


def test_raindrop_payload_has_no_sequence():
    import asyncio

    adapter = RaindropAdapter(enabled=False)
    dirty = {
        "proposal_id": "gep-aaa",
        "workspace_id": "ws-bbb",
        "genome_revision_id": "rev-ccc",
        "sequence": "ACGTACGTACGTACGTACGT",
        "bases": "GATTACAGATTACAGATTACA",
        "transcript": "change position 6 from G to A",
    }
    asyncio.run(adapter.record_ids("genome_edit.applied", dirty))
    wire = json.dumps(adapter._mock_traces)
    assert "ACGTACGTACGTACGTACGT" not in wire
    assert "GATTACA" not in wire
    payload = adapter._mock_traces[0]["payload"]
    assert payload["proposal_id"] == "gep-aaa"
    assert "sequence" not in payload
    assert "bases" not in payload
    assert "transcript" not in payload


def test_http_interpret_and_apply_flow(client: TestClient):
    from services.api.app.routes import genome_edit as route

    workspace = route._store.create_workspace("http")
    ref, alt = _ready_alt(7)
    parsed = client.post(
        "/api/genome-edit/interpret-command",
        json={"text": f"change position 7 from {ref} to {alt}", "source": "text"},
    )
    assert parsed.status_code == 200
    assert parsed.json()["intent"] == "PRECISE_EDIT"
    assert parsed.json()["parser"] == "deterministic-v14"
    trait = client.post(
        "/api/genome-edit/interpret-command",
        json={"text": "bigger hands please", "source": "text", "workspace_id": workspace["workspace_id"]},
    )
    assert trait.json()["intent"] == "TRAIT_GOAL"
    created = client.post(
        "/api/genome-edit/proposals",
        json={
            "workspace_id": workspace["workspace_id"],
            "parent_revision_id": workspace["active_genome_revision_id"],
            "position": 7,
            "alt": alt,
            "source": "text",
            "stated_ref": ref,
        },
    )
    assert created.status_code == 200
    assert created.json()["validation_status"] == "pending"
    pid = created.json()["proposal_id"]
    assert pid.startswith("gep-")
    pending_apply = client.post(f"/api/genome-edit/proposals/{pid}/apply", json={"expected_counter": workspace["revision_counter"]})
    assert pending_apply.status_code == 400
    validated = client.post(f"/api/genome-edit/proposals/{pid}/validate")
    assert validated.status_code == 200
    assert validated.json()["validation_status"] == "valid"
    stale = client.post(f"/api/genome-edit/proposals/{pid}/apply", json={"expected_counter": 999})
    assert stale.status_code == 409
    first = client.post(
        f"/api/genome-edit/proposals/{pid}/apply",
        json={"expected_counter": workspace["revision_counter"]},
        headers={"Idempotency-Key": "http-apply-1"},
    )
    assert first.status_code == 200
    replay = client.post(
        f"/api/genome-edit/proposals/{pid}/apply",
        json={"expected_counter": first.json()["workspace"]["revision_counter"]},
        headers={"Idempotency-Key": "http-apply-1"},
    )
    assert replay.status_code == 200
    assert replay.json()["workspace"]["revision_counter"] == first.json()["workspace"]["revision_counter"]


def test_voice_status_is_not_connected_or_verified(client: TestClient, monkeypatch):
    monkeypatch.delenv("STT_ENABLED", raising=False)
    monkeypatch.delenv("STT_PROVIDER", raising=False)
    monkeypatch.delenv("STT_API_KEY", raising=False)
    status = client.get("/api/voice/status")
    assert status.status_code == 200
    body = status.json()
    assert body["stt"] == "NOT_CONFIGURED"
    assert body["stt"] != "VERIFIED"
    assert "Connected" not in json.dumps(body)
    denied = client.post("/api/voice/transcribe", json={})
    if denied.status_code == 422:
        assert "transcript" not in denied.json()
    else:
        assert denied.status_code == 501
        assert denied.json()["status"] == "NOT_CONFIGURED"
        assert denied.json()["transcript"] is None
    no_consent = client.post("/api/voice/transcribe", headers={"X-Voice-Consent": "denied"}, json={})
    assert no_consent.status_code in {501, 422}
