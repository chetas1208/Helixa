from __future__ import annotations

import asyncio
import json

import pytest

from services.integrations.mongodb import (
    ArtifactRepository,
    CheckpointRepository,
    DatasetRepository,
    EvaluationRepository,
    EventRepository,
    EvidenceRepository,
    HarnessRepository,
    IntegrationEventRepository,
    MemoryRepository,
    MongoDBClient,
    RunModel,
    RunState,
)
from services.integrations.mongodb.models import (
    ArtifactModel,
    CheckpointModel,
    DatasetModel,
    EvaluationModel,
    EvidenceReceiptModel,
    HarnessMutationModel,
    HarnessVersionModel,
    IntegrationEventModel,
    ResearchMemoryModel,
)

AUDIT_DB = "diamond_audit_mongo_repo_rest"
OVER_CAP = 105


@pytest.fixture
async def mongo():
    client = MongoDBClient(db_name=AUDIT_DB)
    await client.client.drop_database(AUDIT_DB)
    yield client
    await client.client.drop_database(AUDIT_DB)
    await client.close()


class _DelayedRuns:
    """Delays the run-document sync for seq 1 so a later seq lands first."""

    def __init__(self, coll):
        self._coll = coll

    async def update_one(self, flt, update, *args, **kwargs):
        fields = update.get("$max") or update["$set"]
        if fields["seq_counter"] == 1:
            await asyncio.sleep(0.2)
        return await self._coll.update_one(flt, update, *args, **kwargs)


class _DbWithDelayedRuns:
    def __init__(self, db):
        self._db = db
        self.runs = _DelayedRuns(db.runs)

    def __getattr__(self, name):
        return getattr(self._db, name)


async def test_run_seq_counter_never_regresses_when_updates_reorder(mongo):
    await mongo.db.runs.insert_one(RunModel(run_id="run-seq", task_id="t").model_dump(mode="json"))
    repo = EventRepository(db=_DbWithDelayedRuns(mongo.db))
    await asyncio.gather(
        repo.append_event("run-seq", "A"),
        repo.append_event("run-seq", "B"),
    )
    run = await mongo.db.runs.find_one({"run_id": "run-seq"})
    assert run["seq_counter"] == 2


async def test_list_versions_and_lineage_are_not_truncated(mongo):
    repo = HarnessRepository(mongo=mongo)
    for i in range(OVER_CAP):
        await repo.save_version(
            HarnessVersionModel(
                version_id=f"v{i:04d}",
                parent_version_id=f"v{i - 1:04d}" if i else None,
                created_at=f"2026-01-01T00:00:{i:06d}",
            )
        )
    versions = await repo.list_versions()
    assert len(versions) == OVER_CAP
    assert versions[-1].version_id == f"v{OVER_CAP - 1:04d}"
    lineage = await repo.get_lineage("v0000")
    assert len(lineage["nodes"]) == OVER_CAP
    assert len(lineage["edges"]) == OVER_CAP - 1


async def test_list_datasets_not_truncated(mongo, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    repo = DatasetRepository(mongo=mongo)
    for i in range(OVER_CAP):
        await repo.upsert_dataset(DatasetModel(dataset_id=f"ds-{i:04d}"))
    assert len(await repo.list_datasets()) == OVER_CAP


async def test_list_checkpoints_not_truncated(mongo):
    repo = CheckpointRepository(mongo=mongo)
    for i in range(OVER_CAP):
        await repo.save_checkpoint(
            CheckpointModel(
                checkpoint_id=f"cp-{i}",
                run_id="run-cp",
                step_index=i,
                state=RunState.RUNNING,
                active_harness_id="h",
            )
        )
    cps = await repo.list_checkpoints("run-cp")
    assert [c.step_index for c in cps] == list(range(OVER_CAP))
    latest = await repo.get_latest_checkpoint("run-cp")
    assert latest is not None and latest.step_index == OVER_CAP - 1
    assert latest.state == RunState.RUNNING


async def test_list_memories_by_run_not_truncated(mongo):
    repo = MemoryRepository(mongo=mongo)
    for i in range(OVER_CAP):
        await repo.save_memory(
            ResearchMemoryModel(
                memory_id=f"m-{i}", run_id="run-m", content="c", timestamp=f"2026-01-01T00:00:{i:06d}"
            )
        )
    memories = await repo.list_by_run("run-m")
    assert len(memories) == OVER_CAP
    assert memories[-1].memory_id == f"m-{OVER_CAP - 1}"


async def test_list_artifacts_by_run_and_dataset_not_truncated(mongo):
    repo = ArtifactRepository(mongo=mongo)
    for i in range(OVER_CAP):
        await repo.upsert_artifact(
            ArtifactModel(
                artifact_id=f"a-{i}",
                artifact_sha256=f"{i:064x}",
                dataset_id="ds-a",
                run_id="run-a",
                filename="f.vcf",
                file_format="vcf",
                byte_size=1,
                storage_path="/x",
            )
        )
    assert len(await repo.list_by_run("run-a")) == OVER_CAP
    assert len(await repo.list_by_dataset("ds-a")) == OVER_CAP


async def test_get_dataset_default_alias_does_not_overwrite_persisted_dataset(mongo, monkeypatch, tmp_path):
    manifest_dir = tmp_path / "fixtures" / "manifests"
    manifest_dir.mkdir(parents=True)
    (manifest_dir / "dataset_manifest.json").write_text(
        json.dumps({"dataset_id": "AUDIT-DS", "declared_assembly": "GRCh38", "dataset_metadata": {"src": "manifest"}})
    )
    monkeypatch.chdir(tmp_path)
    repo = DatasetRepository(mongo=mongo)
    await repo.upsert_dataset(
        DatasetModel(dataset_id="AUDIT-DS", declared_assembly="GRCh37", metadata={"src": "persisted"})
    )

    ds = await repo.get_dataset("default")

    assert ds is not None
    assert ds.metadata == {"src": "persisted"}
    assert ds.declared_assembly == "GRCh37"
    stored = await mongo.db.datasets.find_one({"dataset_id": "AUDIT-DS"}, {"_id": 0})
    assert stored["metadata"] == {"src": "persisted"}
    assert stored["declared_assembly"] == "GRCh37"


async def test_get_dataset_manifest_fallback_syncs_when_not_persisted(mongo, monkeypatch, tmp_path):
    manifest_dir = tmp_path / "fixtures" / "manifests"
    manifest_dir.mkdir(parents=True)
    (manifest_dir / "dataset_manifest.json").write_text(
        json.dumps({"dataset_id": "AUDIT-DS", "dataset_metadata": {"src": "manifest"}})
    )
    monkeypatch.chdir(tmp_path)
    repo = DatasetRepository(mongo=mongo)
    assert await repo.get_dataset("nope") is None
    ds = await repo.get_dataset("default")
    assert ds is not None and ds.dataset_id == "AUDIT-DS" and ds.metadata == {"src": "manifest"}
    assert (await repo.get_dataset("AUDIT-DS")) is not None
    assert [d.dataset_id for d in await repo.list_datasets()] == ["AUDIT-DS"]


async def test_event_sequence_idempotency_and_paging(mongo):
    repo = EventRepository(mongo=mongo)
    e1 = await repo.append_event("run-e", "A", idempotency_key="k1", payload={"x": 1})
    dup = await repo.append_event("run-e", "A", idempotency_key="k1", payload={"x": 2})
    e2 = await repo.append_event("run-e", "B")
    assert (e1.seq, dup.seq, e2.seq) == (1, 1, 2)
    assert dup.payload == {"x": 1}
    page = await repo.get_events("run-e", after_seq=1, limit=10)
    assert [e.seq for e in page] == [2]
    latest = await repo.get_latest_event("run-e")
    assert latest is not None and latest.seq == 2
    assert await repo.get_latest_event("missing") is None
    assert await repo.get_events("missing") == []


async def test_evidence_evaluation_mutation_integration_roundtrips_have_no_object_id(mongo):
    ev = EvidenceRepository(mongo=mongo)
    receipt = EvidenceReceiptModel(
        receipt_id="r1", receipt_digest="d1", run_id="run-r", candidate_version_id="c", score="1/1", promoted=True
    )
    await ev.save_receipt(receipt)
    assert (await ev.get_receipt("r1")) == receipt
    assert (await ev.get_receipt_by_digest("d1")) == receipt
    assert (await ev.get_receipt_by_run("run-r")) == receipt
    assert await ev.get_receipt("nope") is None

    evals = EvaluationRepository(mongo=mongo)
    em = EvaluationModel(
        evaluation_id="e1",
        run_id="run-r",
        candidate_version_id="c",
        parent_version_id="p",
        candidate_score="1/1",
        parent_score="0/1",
        false_positive_rate=0.0,
        promoted=True,
        receipt_id="r1",
    )
    await evals.save_evaluation(em)
    assert (await evals.get_evaluation("e1")) == em
    assert (await evals.get_by_run("run-r")) == em

    hr = HarnessRepository(mongo=mongo)
    mut = HarnessMutationModel(mutation_id="m1", parent_version_id="p", candidate_version_id="c", run_id="run-r")
    await hr.record_mutation(mut)
    stored = await mongo.db.harness_mutations.find_one({"mutation_id": "m1"}, {"_id": 0})
    assert stored["candidate_version_id"] == "c"

    ir = IntegrationEventRepository(mongo=mongo)
    for i in range(3):
        await ir.log_event(
            IntegrationEventModel(
                event_id=f"i{i}", component="x" if i < 2 else "y", action="a", status="s",
                timestamp=f"2026-01-01T00:00:0{i}",
            )
        )
    assert [e.event_id for e in await ir.list_events()] == ["i2", "i1", "i0"]
    assert [e.event_id for e in await ir.list_events(component="x", limit=1)] == ["i1"]
