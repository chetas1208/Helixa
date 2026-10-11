from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from services.api.app.routes import runs
from services.integrations.mongodb import MongoDBClient, RunModel, RunRepository, RunState
from services.integrations.mongodb.models import RunEventModel

AUDIT_DB = "diamond_audit_route_runs"


@pytest.fixture
async def mongo():
    client = MongoDBClient(db_name=AUDIT_DB)
    await client.client.drop_database(AUDIT_DB)
    yield client
    await client.client.drop_database(AUDIT_DB)
    await client.client.close()


@pytest.fixture
async def api(mongo):
    app = FastAPI()
    app.include_router(runs.router)
    app.state.mongo = mongo
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def test_create_run_ids_unique_within_same_second(api, mongo, monkeypatch):
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 1, 1, tzinfo=UTC)

    monkeypatch.setattr(runs, "datetime", FixedDatetime)
    first = (await api.post("/api/runs", json={"task_id": "t-one"})).json()
    second = (await api.post("/api/runs", json={"task_id": "t-two"})).json()
    assert first["run_id"] != second["run_id"]
    repo = RunRepository(mongo=mongo)
    stored_first = await repo.get_run(first["run_id"])
    assert stored_first is not None and stored_first.task_id == "t-one"


@pytest.mark.parametrize("field", ["vcf_filename", "fasta_filename"])
@pytest.mark.parametrize(
    "name",
    ["../../etc/passwd", "/etc/passwd", "a/b.vcf", "a\\b.vcf", "x\x00.vcf", "x" * 256],
)
async def test_create_run_rejects_non_plain_filenames(api, field, name):
    resp = await api.post("/api/runs", json={field: name})
    assert resp.status_code == 422


async def test_create_run_accepts_defaults_and_plain_names(api):
    resp = await api.post("/api/runs", json={"vcf_filename": "valid_snvs.vcf"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["vcf_filename"] == "valid_snvs.vcf"
    assert body["status"] == "CREATED"


@pytest.mark.parametrize("name", ["/etc/passwd", "../../etc/passwd", "x" * 300])
async def test_evolve_rejects_unsafe_stored_filename(api, mongo, name):
    repo = RunRepository(mongo=mongo)
    await repo.create_run(RunModel(run_id="r-unsafe", task_id="t", vcf_filename=name))
    resp = await api.post("/api/runs/r-unsafe/evolve")
    assert resp.status_code == 422
    events = await api.get("/api/runs/r-unsafe/events")
    assert events.json()["events"] == []


async def test_evolve_finished_run_is_idempotent(api):
    run_id = (await api.post("/api/runs", json={})).json()["run_id"]
    first = await api.post(f"/api/runs/{run_id}/evolve")
    assert first.status_code == 200
    before = (await api.get(f"/api/runs/{run_id}/events")).json()["events"]
    second = await api.post(f"/api/runs/{run_id}/evolve")
    assert second.status_code == 200
    assert second.json()["status"] == first.json()["status"]
    after = (await api.get(f"/api/runs/{run_id}/events")).json()["events"]
    assert [e["seq"] for e in after] == [e["seq"] for e in before]
    assert [e["event_type"] for e in after].count("run.completed") == 1


@pytest.mark.parametrize("state", [RunState.FAILED, RunState.CANCELLED])
async def test_evolve_dead_run_conflicts_without_side_effects(api, mongo, state):
    repo = RunRepository(mongo=mongo)
    await repo.create_run(RunModel(run_id="r-dead", task_id="t", status=state))
    resp = await api.post("/api/runs/r-dead/evolve")
    assert resp.status_code == 409
    events = await api.get("/api/runs/r-dead/events")
    assert events.json()["events"] == []


async def test_evolve_unknown_run_404(api):
    assert (await api.post("/api/runs/nope/evolve")).status_code == 404
    assert (await api.get("/api/runs/nope")).status_code == 404


async def test_events_after_seq_out_of_range_is_422(api):
    resp = await api.get(f"/api/runs/r/events?after_seq={2**70}")
    assert resp.status_code == 422


async def test_events_after_seq_filters(api):
    run_id = (await api.post("/api/runs", json={})).json()["run_id"]
    await api.post(f"/api/runs/{run_id}/evolve")
    events = (await api.get(f"/api/runs/{run_id}/events")).json()["events"]
    tail = (await api.get(f"/api/runs/{run_id}/events?after_seq=3")).json()["events"]
    assert [e["seq"] for e in tail] == [e["seq"] for e in events if e["seq"] > 3]


class _FakeRequest:
    def __init__(self, last_event_id: str | None) -> None:
        self.headers = {} if last_event_id is None else {"Last-Event-ID": last_event_id}
        self._calls = 0

    async def is_disconnected(self) -> bool:
        self._calls += 1
        return self._calls > 1


class _FakeEventRepo:
    def __init__(self) -> None:
        self.after_seqs: list[int] = []

    async def get_events(self, run_id: str, after_seq: int = 0, limit: int = 100):
        self.after_seqs.append(after_seq)
        return [RunEventModel(event_id="e", run_id=run_id, seq=after_seq + 1, event_type="x")]


async def _first_chunk(last_event_id: str | None):
    repo = _FakeEventRepo()
    resp = await runs.stream_run_events("r", _FakeRequest(last_event_id), repo)
    chunks = [c async for c in resp.body_iterator]
    return repo.after_seqs, chunks


async def test_stream_honours_ascii_last_event_id():
    after_seqs, chunks = await _first_chunk("5")
    assert after_seqs == [5]
    assert chunks[0].startswith("id: 6\n")


@pytest.mark.parametrize("header", ["\u00b2", "-1", "abc", "9" * 40, str(2**63)])
async def test_stream_ignores_invalid_last_event_id(header):
    after_seqs, chunks = await _first_chunk(header)
    assert after_seqs == [0]
    assert chunks[0].startswith("id: 1\n")
