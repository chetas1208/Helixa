import json
from pathlib import Path

import pytest
from pymongo import MongoClient

from services.runtime.v8 import experiment

ROOT = Path(__file__).resolve().parents[2]
AUDIT_DB = "diamond_audit_v8_experiment"


@pytest.fixture(autouse=True)
def audit_db(monkeypatch):
    monkeypatch.setenv("MONGODB_DATABASE", AUDIT_DB)
    yield
    try:
        client = MongoClient("mongodb://127.0.0.1:27017", serverSelectionTimeoutMS=800)
        client.drop_database(AUDIT_DB)
        client.close()
    except Exception:
        pass


def test_fresh_rerun_in_same_output_dir_is_not_blocked_by_stale_pointer(tmp_path: Path):
    first = experiment.run_campaign(tmp_path, fixtures_root=ROOT)
    assert first["promoted"] is True
    second = experiment.run_campaign(tmp_path, fixtures_root=ROOT)
    assert second["promoted"] is True
    assert second["promotion_writes"] == 1
    assert second["active_version_id"] == first["active_version_id"]


def test_resume_after_failure_following_pointer_claim_still_reports_promotion(
    tmp_path: Path, monkeypatch
):
    experiment.run_campaign(tmp_path, fixtures_root=ROOT, crash_after="evaluated")
    real_mint = experiment.mint_v8_receipt
    calls = {"n": 0}

    def flaky_mint(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("simulated crash after promotion claim")
        return real_mint(*args, **kwargs)

    monkeypatch.setattr(experiment, "mint_v8_receipt", flaky_mint)
    with pytest.raises(RuntimeError):
        experiment.run_campaign(tmp_path, fixtures_root=ROOT, resume=True)
    resumed = experiment.run_campaign(tmp_path, fixtures_root=ROOT, resume=True)
    assert resumed["status"] == "COMPLETED"
    assert resumed["promoted"] is True
    assert resumed["promotion_writes"] == 1


def test_input_not_rewritten_gate_is_computed_not_asserted(tmp_path: Path, monkeypatch):
    experiment.run_campaign(tmp_path, fixtures_root=ROOT, crash_after="evaluated")
    real_sha = experiment.compute_sha256
    vcf = ROOT / experiment.INCIDENT_FIXTURE

    def tampered(path, *args, **kwargs):
        if Path(path) == vcf:
            return "0" * 64
        return real_sha(path, *args, **kwargs)

    monkeypatch.setattr(experiment, "compute_sha256", tampered)
    experiment.run_campaign(tmp_path, fixtures_root=ROOT, resume=True)
    receipt = json.loads((tmp_path / "evidence_receipt.json").read_text())
    assert receipt["safety_gates"]["input_not_rewritten"] is False
    assert receipt["fingerprint_verified"] is True


def test_failed_write_leaves_previous_json_intact(tmp_path: Path, monkeypatch):
    target = tmp_path / "state.json"
    experiment._write(target, {"a": 1})
    original = Path.write_text

    def crashing_write_text(self, data, *args, **kwargs):
        original(self, data[: len(data) // 2], *args, **kwargs)
        raise OSError("disk full")

    monkeypatch.setattr(Path, "write_text", crashing_write_text)
    with pytest.raises(OSError):
        experiment._write(target, {"a": 2, "b": "x" * 50})
    monkeypatch.setattr(Path, "write_text", original)
    assert json.loads(target.read_text()) == {"a": 1}
    assert not [p for p in tmp_path.iterdir() if p.name != "state.json"]
