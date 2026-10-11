"""V14 intent guardrails: trait goals are not mutations; voice never proposes."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from services.runtime.genome_workspace.store import WorkspaceStore
from services.tests.test_v14_guardrails import REPO_OWNER_4, require_status

TRAIT_GOALS = (
    "make my hands bigger",
    "bigger hands",
    "stronger legs",
    "smarter brain",
    "survive extreme cold",
    "change my eye colour",
    "change my eye color",
)


@pytest.fixture
def isolated_client(tmp_path, monkeypatch):
    monkeypatch.setenv("V10_STATE_PATH", str(tmp_path / "v14_guardrails_intent.json"))
    from services.api.app.routes import v10

    previous = v10._store
    v10._store = WorkspaceStore(path=tmp_path / "v14_guardrails_intent.json")
    try:
        from services.api.app.main import app

        yield TestClient(app)
    finally:
        v10._store = previous


def _interpret(client: TestClient, text: str, source: str = "text") -> dict:
    response = client.post(
        "/api/genome-edit/interpret-command",
        json={"text": text, "source": source},
    )
    require_status(response, "POST /api/genome-edit/interpret-command", REPO_OWNER_4)
    return response.json()


def test_uv_resistance_is_a_research_record_not_an_edit(isolated_client: TestClient):
    payload = _interpret(
        isolated_client,
        "Make the virtual organism more resistant to ultraviolet radiation.",
    )
    assert payload.get("intent") == "TRAIT_GOAL"
    assert not payload.get("edit")
    research = (payload.get("trait_goal") or {}).get("research") or {}
    assert research.get("user_intent") == "Explore increased UV tolerance"
    assert research.get("research_area") == "Pigmentation and DNA repair"
    assert research.get("evidence") == "Research retrieval required"
    assert research.get("candidate_edit") == "Pending evidence-based identification"
    assert research.get("dna_rendering") == "Available after validated edit"
    assert research.get("body_rendering") == "Hypothetical unless supported"
    assert research.get("approval") == "Required before applying"
    blob = " ".join(str(value) for value in research.values())
    assert ">" not in blob
    assert "chr" not in blob.lower()


def test_make_my_hands_bigger_is_trait_goal_not_a_mutation(isolated_client: TestClient):
    for text in TRAIT_GOALS:
        payload = _interpret(isolated_client, text)
        assert payload.get("intent") == "TRAIT_GOAL", (
            f"{text!r} must route to TRAIT_GOAL, never PRECISE_EDIT. Got {payload.get('intent')!r}."
        )
        assert not payload.get("edit"), f"{text!r} must not produce an edit."
        goal = payload.get("trait_goal") or {}
        assert goal.get("why_not_automatic"), f"{text!r} needs why_not_automatic."
        assert payload.get("parser") == "deterministic-v14"


def test_trait_goal_does_not_create_a_proposal_or_revision(isolated_client: TestClient):
    ws = isolated_client.post("/api/v10/genome/workspaces", json={"name": "v14-trait"})
    require_status(ws, "POST /api/v10/genome/workspaces", REPO_OWNER_4)
    workspace = ws.json()
    before = workspace["revision_counter"]
    payload = _interpret(isolated_client, "make my hands bigger")
    assert payload["intent"] == "TRAIT_GOAL"
    listed = isolated_client.get("/api/genome-edit/proposals/gep-does-not-exist")
    assert listed.status_code in {400, 404}
    after = isolated_client.get(f"/api/v10/genome/workspaces/{workspace['workspace_id']}")
    require_status(after, "GET workspace", REPO_OWNER_4)
    assert after.json()["revision_counter"] == before
    assert after.json()["edit_count"] == 0


def test_typed_and_voice_share_the_same_interpret_shape(isolated_client: TestClient):
    typed = _interpret(isolated_client, "make my hands bigger", source="text")
    voiced = _interpret(isolated_client, "make my hands bigger", source="voice")
    assert typed.get("source") == "text"
    assert voiced.get("source") == "voice"
    assert typed.get("parser") == voiced.get("parser") == "deterministic-v14"
    assert typed["intent"] == voiced["intent"], "typed and voice must agree on intent"
    assert typed.get("edit") == voiced.get("edit")
    assert typed["intent"] == "TRAIT_GOAL", (
        f"make my hands bigger must be TRAIT_GOAL on both paths, got typed={typed['intent']!r} "
        f"voice={voiced['intent']!r}"
    )


def test_voice_transcribe_never_proposes_or_applies(isolated_client: TestClient):
    ws = isolated_client.post("/api/v10/genome/workspaces", json={"name": "v14-voice"})
    require_status(ws, "POST /api/v10/genome/workspaces", REPO_OWNER_4)
    before = ws.json()

    no_consent = isolated_client.post("/api/voice/transcribe", json={})
    body = no_consent.json() if no_consent.headers.get("content-type", "").startswith("application/json") else {}
    assert "proposal_id" not in body
    assert body.get("transcript") in {None, "", "NOT_CONFIGURED"} or no_consent.status_code in {401, 403, 422, 501}

    granted = isolated_client.post(
        "/api/voice/transcribe",
        json={},
        headers={"X-Voice-Consent": "granted"},
    )
    granted_body = granted.json() if granted.headers.get("content-type", "").startswith("application/json") else {}
    assert "proposal_id" not in granted_body
    if granted.status_code == 200:
        assert granted_body.get("confidence_kind") == "transcription"
        assert "proposal" not in granted_body

    after = isolated_client.get(f"/api/v10/genome/workspaces/{before['workspace_id']}")
    assert after.json()["edit_count"] == 0
    assert after.json()["revision_counter"] == before["revision_counter"]


def test_voice_status_is_never_connected_without_a_round_trip(isolated_client: TestClient):
    response = isolated_client.get("/api/voice/status")
    if response.status_code == 404:
        pytest.fail(
            f"{REPO_OWNER_4} has not landed GET /api/voice/status. "
            "STT must report CONFIGURED|NOT_CONFIGURED|VERIFIED; VERIFIED only after a real round-trip."
        )
    payload = response.json()
    stt = payload.get("stt")
    assert stt in {"CONFIGURED", "NOT_CONFIGURED", "VERIFIED"}, payload
    if stt == "VERIFIED":
        assert payload.get("verified_at"), "VERIFIED requires verified_at from a real round-trip."
    assert stt != "Connected"
    assert "connected" not in str(payload).lower() or stt == "VERIFIED"
