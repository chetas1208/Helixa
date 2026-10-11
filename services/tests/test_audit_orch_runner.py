from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

from services.integrations.mongodb import (
    FencingTokenConflictError,
    MongoDBClient,
    RunModel,
    RunRepository,
    RunState,
)
from services.runtime.orchestration import AgentRunner

AUDIT_DB = "diamond_audit_orch_runner"
FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


@pytest.fixture
async def mongo():
    client = MongoDBClient(db_name=AUDIT_DB)
    await client.client.drop_database(AUDIT_DB)
    await client.init_indexes()
    yield client
    await client.client.drop_database(AUDIT_DB)
    await client.client.close()


@pytest.fixture
def runner(mongo):
    return AgentRunner(mongo, fixtures_dir=FIXTURES)


async def _events(runner, run_id):
    return await runner.events.get_events(run_id, limit=500)


def _crash_on_checkpoint(runner, state):
    original = runner.save_checkpoint

    async def crashing(run_id, step_index, cp_state, *args, **kwargs):
        if cp_state == state:
            raise RuntimeError("simulated crash")
        return await original(run_id, step_index, cp_state, *args, **kwargs)

    runner.save_checkpoint = crashing


def _crash_on_event(runner, event_type):
    original = runner.emit_event

    async def crashing(run_id, seq, etype, *args, **kwargs):
        if etype == event_type:
            raise RuntimeError("simulated crash")
        return await original(run_id, seq, etype, *args, **kwargs)

    runner.emit_event = crashing


@pytest.mark.parametrize("field", ["vcf_filename", "fasta_filename"])
@pytest.mark.parametrize(
    "name",
    ["../invalid/ref_mismatch.vcf", "/etc/passwd", "a/b.vcf", "a\\b.vcf", "x\x00.vcf", "", "x" * 256],
)
async def test_unsafe_filenames_rejected_before_any_persistence(runner, mongo, field, name):
    kwargs = {"vcf_filename": "ref_mismatch.vcf", "fasta_filename": "ref_synthetic_chr22.fasta"}
    kwargs[field] = name
    with pytest.raises(ValueError):
        await runner.execute_run("t-unsafe", "run-unsafe", **kwargs)
    assert await RunRepository(mongo=mongo).get_run("run-unsafe") is None
    assert await _events(runner, "run-unsafe") == []


async def test_missing_vcf_fails_loudly_instead_of_promoting(runner, mongo):
    with pytest.raises(FileNotFoundError):
        await runner.execute_run("t-missing", "run-missing", "does_not_exist.vcf")
    assert await RunRepository(mongo=mongo).get_run("run-missing") is None
    assert await _events(runner, "run-missing") == []
    assert await runner.checkpoints.get_latest_checkpoint("run-missing") is None


async def test_clean_vcf_does_not_claim_ref_mismatch(runner):
    await runner.execute_run("t-clean", "run-clean", "valid_snvs.vcf")
    events = await _events(runner, "run-clean")
    validation = next(e for e in events if e.event_type == "run.validation.completed")
    assert validation.payload["oracle_status"] == "PASS"
    assert not any(e.event_type == "reference.check.failed" for e in events)


async def test_mismatching_vcf_records_ref_failure_exactly_once(runner):
    await runner.execute_run("t-bad", "run-bad", "ref_mismatch.vcf")
    events = await _events(runner, "run-bad")
    validation = next(e for e in events if e.event_type == "run.validation.completed")
    assert validation.payload["oracle_status"] == "FAIL"
    assert [e.event_type for e in events].count("reference.check.failed") == 1


async def test_resume_after_crash_does_not_duplicate_events(mongo):
    crashing = AgentRunner(mongo, fixtures_dir=FIXTURES)
    _crash_on_checkpoint(crashing, RunState.DIAGNOSING)
    with pytest.raises(RuntimeError):
        await crashing.execute_run("t-dup", "run-dup", "ref_mismatch.vcf", fence_token=1)

    resumed = AgentRunner(mongo, fixtures_dir=FIXTURES)
    result = await resumed.execute_run("t-dup", "run-dup", "ref_mismatch.vcf", fence_token=1)
    assert result["status"] == "PROMOTED"

    events = await _events(resumed, "run-dup")
    counts = Counter(e.event_type for e in events)
    for once in (
        "run.created",
        "run.validation.completed",
        "reference.check.failed",
        "run.diagnosis.completed",
        "harness.candidate.created",
        "evaluation.finished",
        "candidate.promoted",
        "run.completed",
    ):
        assert counts[once] == 1, once
    transitions = [(e.payload["from"], e.payload["to"]) for e in events if e.event_type == "run.state.transition"]
    assert len(transitions) == len(set(transitions)) == 4
    assert [e.seq for e in events] == list(range(1, len(events) + 1))


async def test_rerun_of_finished_run_does_not_repeat_completion_event(runner):
    await runner.execute_run("t-rerun", "run-rerun", "ref_mismatch.vcf", fence_token=1)
    again = await runner.execute_run("t-rerun", "run-rerun", "ref_mismatch.vcf", fence_token=1)
    assert again["status"] == "PROMOTED"
    events = await _events(runner, "run-rerun")
    assert [e.event_type for e in events].count("run.completed") == 1


@pytest.mark.parametrize("promoted", [True, False])
async def test_resume_after_decision_committed_does_not_get_stuck(mongo, promoted):
    run_id = f"run-decided-{promoted}"

    def force_decision(runner):
        real = runner.evaluator.evaluate

        def evaluate(*args, **kwargs):
            result, receipt = real(*args, **kwargs)
            return result.model_copy(update={"promoted": promoted}), receipt.model_copy(
                update={"promoted": promoted}
            )

        runner.evaluator.evaluate = evaluate

    crashing = AgentRunner(mongo, fixtures_dir=FIXTURES)
    force_decision(crashing)
    _crash_on_event(crashing, "candidate.promoted" if promoted else "candidate.rejected")
    with pytest.raises(RuntimeError):
        await crashing.execute_run("t-decided", run_id, "ref_mismatch.vcf", fence_token=1)

    resumed = AgentRunner(mongo, fixtures_dir=FIXTURES)
    force_decision(resumed)
    result = await resumed.execute_run("t-decided", run_id, "ref_mismatch.vcf", fence_token=1)

    expected = "PROMOTED" if promoted else "REJECTED"
    assert result["status"] == expected
    assert result["active_harness_version"] == (
        "harness-v2-candidate" if promoted else "harness-v1"
    )
    receipts = await mongo.db.evidence_receipts.find({"run_id": run_id}).to_list(length=10)
    assert len(receipts) == 1
    assert result["evidence_receipt_id"] == receipts[0]["receipt_id"]
    events = await _events(resumed, run_id)
    final_event = "candidate.promoted" if promoted else "candidate.rejected"
    assert [e.event_type for e in events].count(final_event) == 1
    assert [e.event_type for e in events].count("evaluation.finished") == 1
    latest = await resumed.checkpoints.get_latest_checkpoint(run_id)
    assert latest is not None and latest.state.value == expected
    assert latest.evidence_receipt_id == receipts[0]["receipt_id"]


async def test_stale_fence_token_is_rejected_before_any_write(runner, mongo):
    repo = RunRepository(mongo=mongo)
    await repo.create_run(
        RunModel(
            run_id="run-stale",
            task_id="t-stale",
            status=RunState.CREATED,
            fence_token=3,
            vcf_filename="ref_mismatch.vcf",
        )
    )
    with pytest.raises(FencingTokenConflictError):
        await runner.execute_run("t-stale", "run-stale", "ref_mismatch.vcf", fence_token=2)
    assert await _events(runner, "run-stale") == []
    assert await runner.checkpoints.get_latest_checkpoint("run-stale") is None
    assert await mongo.db.harness_versions.count_documents({}) == 0


async def test_fresh_run_happy_path_is_unchanged(runner, mongo):
    result = await runner.execute_run("t-ok", "run-ok", "ref_mismatch.vcf", fence_token=4)
    assert result["status"] == "PROMOTED"
    assert result["fence_token"] == 4
    assert result["active_harness_version"] == "harness-v2-candidate"
    assert result["candidate_harness_version"] == "harness-v2-candidate"
    receipt = await mongo.db.evidence_receipts.find_one({"run_id": "run-ok"})
    assert receipt is not None and receipt["promoted"] is True and receipt["score"] == "6/6"
    assert result["evidence_receipt_id"] == receipt["receipt_id"]
    events = await _events(runner, "run-ok")
    assert [e.event_type for e in events] == [
        "run.created",
        "run.state.transition",
        "run.validation.completed",
        "reference.check.failed",
        "run.state.transition",
        "run.diagnosis.completed",
        "run.state.transition",
        "harness.candidate.created",
        "run.state.transition",
        "evaluation.finished",
        "candidate.promoted",
        "run.completed",
    ]


async def test_busy_run_is_not_executed_twice(runner, mongo):
    await runner.runs.create_run(
        RunModel(
            run_id="run-busy",
            task_id="t-busy",
            status=RunState.CREATED,
            fence_token=1,
            vcf_filename="ref_mismatch.vcf",
        )
    )
    await mongo.db.runs.update_one({"run_id": "run-busy"}, {"$set": {"executing": True}})
    result = await runner.execute_run("t-busy", "run-busy", "ref_mismatch.vcf", fence_token=1)
    assert result["status"] == "CREATED"
    assert await _events(runner, "run-busy") == []
