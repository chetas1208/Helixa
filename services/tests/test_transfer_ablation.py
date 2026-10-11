import json
from pathlib import Path

import pytest

from services.runtime.evidence.proof_receipt import compute_v8_receipt_digest
from services.runtime.v8.experiment import run_campaign

ROOT = Path(__file__).resolve().parents[2]


def test_campaign_promotes_repair_and_isolates_holdout(tmp_path: Path):
    result = run_campaign(tmp_path, fixtures_root=ROOT)
    assert result["status"] == "COMPLETED"
    assert result["promoted"] is True
    assert result["fingerprint_matches"] is True
    assert result["promotion_writes"] == 1

    diff = json.loads((tmp_path / "harness_diff.json").read_text())
    assert diff["meta_harness_imported"] is False
    assert diff["gepa_optimize_called"] is False
    assert any(item.get("intentionally_unsafe") and not item["accepted_for_evaluation"] for item in diff["candidates"])
    holdout = json.loads((tmp_path / "holdout_results.json").read_text())
    assert holdout["isolated_from_proposer"] is True
    assert holdout["cases"]
    assert all(case["candidate_passed"] for case in holdout["cases"])
    metrics = json.loads((tmp_path / "runtime_metrics.json").read_text())
    assert metrics["model_calls"] == 0
    assert metrics["gepa_optimize_calls"] == 0
    assert metrics["control_detected"] == 0
    assert metrics["gepa_status"] == "INSTALLED_UNCONFIGURED"
    receipt = json.loads((tmp_path / "evidence_receipt.json").read_text())
    again = compute_v8_receipt_digest(
        run_id=receipt["run_id"],
        incident_id=receipt["incident_id"],
        candidate_hash=receipt["candidate_hash"],
        dual_validator_agreement=receipt["dual_validator_agreement"],
        safety_gates=receipt["safety_gates"],
        decision=receipt["decision"],
    )
    assert again == receipt["receipt_digest"]
    briefing = json.loads((tmp_path / "briefing.json").read_text())
    assert "ACTGACTG" not in briefing["script"]
    assert briefing["automatic"] is False


def test_checkpoint_resume_does_not_repeat_evaluation(tmp_path: Path):
    interrupted = run_campaign(tmp_path, fixtures_root=ROOT, crash_after="evaluated")
    assert interrupted["status"] == "INTERRUPTED"
    assert not (tmp_path / "evidence_receipt.json").exists()
    stored = json.loads((tmp_path / "checkpoint.json").read_text())
    assert stored["effects"]["evaluated"]["eval_runs"] == 1

    resumed = run_campaign(tmp_path, fixtures_root=ROOT, resume=True)
    assert resumed["status"] == "COMPLETED"
    assert resumed["promotion_writes"] == 1
    stored_after = json.loads((tmp_path / "checkpoint.json").read_text())
    assert stored_after["effects"]["evaluated"]["eval_runs"] == 1

    second = run_campaign(tmp_path, fixtures_root=ROOT, resume=True)
    assert second["promotion_writes"] == 1
    assert second["fingerprint"] == resumed["fingerprint"]


def test_resume_uses_mongodb_when_the_json_copy_is_removed(tmp_path: Path):
    interrupted = run_campaign(tmp_path, fixtures_root=ROOT, crash_after="evaluated")
    assert interrupted["status"] == "INTERRUPTED"
    if interrupted.get("checkpoint_backend") != "mongodb":
        pytest.skip("local MongoDB was not reachable; JSON checkpoint remains the offline copy")
    (tmp_path / "checkpoint.json").unlink()
    resumed = run_campaign(tmp_path, fixtures_root=ROOT, resume=True)
    assert resumed["status"] == "COMPLETED"
    assert resumed["promotion_writes"] == 1
    assert resumed["checkpoint_backend"] == "mongodb"
    stored = json.loads((tmp_path / "checkpoint.json").read_text())
    assert stored["effects"]["evaluated"]["eval_runs"] == 1
