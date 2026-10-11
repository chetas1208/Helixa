import uuid
from pathlib import Path

import pytest
from pymongo.errors import PyMongoError, ServerSelectionTimeoutError

from services.runtime.v8 import checkpoint_store as cs
from services.runtime.v8.contracts import (
    Adjudication,
    EvidenceReceiptV8,
    IntegrationStatus,
    OptimizerProvenance,
)

AUDIT_DB = "diamond_audit_v8_store_contracts"


class _Collection:
    def __init__(self, fail: bool = False):
        self.fail = fail

    def _maybe_fail(self):
        if self.fail:
            raise PyMongoError("write failed")

    def replace_one(self, *args, **kwargs):
        self._maybe_fail()

    def find_one(self, *args, **kwargs):
        self._maybe_fail()
        return {"state": {"completed": []}}

    def update_one(self, *args, **kwargs):
        self._maybe_fail()

    def find_one_and_update(self, *args, **kwargs):
        self._maybe_fail()
        return {"active_version_id": "c"}


class _Admin:
    def __init__(self, fail: bool):
        self.fail = fail

    def command(self, name):
        if self.fail:
            raise ServerSelectionTimeoutError("unreachable")


class _FakeClient:
    def __init__(self, ping_fails: bool = False, op_fails: bool = False):
        self.admin = _Admin(ping_fails)
        self._coll = _Collection(op_fails)
        self.closed = 0

    def __getitem__(self, name):
        return self

    def __getattr__(self, name):
        return self._coll

    def close(self):
        self.closed += 1


def _patch(monkeypatch, **kwargs):
    fake = _FakeClient(**kwargs)
    monkeypatch.setattr(cs, "_client", lambda: fake)
    return fake


@pytest.mark.parametrize("ping_fails,op_fails", [(True, False), (False, True)])
def test_save_checkpoint_closes_client_on_error(monkeypatch, tmp_path, ping_fails, op_fails):
    fake = _patch(monkeypatch, ping_fails=ping_fails, op_fails=op_fails)
    assert cs.save_checkpoint(tmp_path, {"completed": []}) == "file"
    assert fake.closed == 1


@pytest.mark.parametrize("ping_fails,op_fails", [(True, False), (False, True)])
def test_load_checkpoint_closes_client_on_error(monkeypatch, tmp_path, ping_fails, op_fails):
    fake = _patch(monkeypatch, ping_fails=ping_fails, op_fails=op_fails)
    assert cs.load_checkpoint(tmp_path) is None
    assert fake.closed == 1


@pytest.mark.parametrize("ping_fails,op_fails", [(True, False), (False, True)])
def test_claim_promotion_closes_client_on_error(monkeypatch, tmp_path, ping_fails, op_fails):
    fake = _patch(monkeypatch, ping_fails=ping_fails, op_fails=op_fails)
    assert cs.claim_promotion(tmp_path, "p", "c") is False
    assert fake.closed == 1


def test_success_paths_close_client_once(monkeypatch, tmp_path):
    fake = _patch(monkeypatch)
    assert cs.save_checkpoint(tmp_path, {"completed": []}) == "mongodb"
    assert cs.load_checkpoint(tmp_path) == {"completed": []}
    assert cs.claim_promotion(tmp_path, "p", "c") is True
    assert fake.closed == 3


def test_namespace_is_stable_and_distinct_per_directory(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    assert cs.namespace_for(a) == cs.namespace_for(a)
    assert cs.namespace_for(a) == cs.namespace_for(tmp_path / "x" / ".." / "a")
    assert cs.namespace_for(a) != cs.namespace_for(b)
    assert cs.namespace_for(a).startswith("v8-campaign-")


def test_client_and_database_follow_environment(monkeypatch):
    monkeypatch.setenv("MONGODB_DATABASE", "some_db")
    assert cs._database_name() == "some_db"
    monkeypatch.delenv("MONGODB_DATABASE")
    assert cs._database_name() == "diamond_genome"


@pytest.fixture()
def local_mongo(monkeypatch):
    monkeypatch.setenv("MONGODB_DATABASE", AUDIT_DB)
    assert cs._database_name() == AUDIT_DB
    client = cs._client()
    try:
        client.admin.command("ping")
    except PyMongoError:
        client.close()
        pytest.skip("local MongoDB not reachable")
    yield client
    client.drop_database(AUDIT_DB)
    client.close()


def test_checkpoint_roundtrip_and_replace(local_mongo, tmp_path):
    out = tmp_path / f"run-{uuid.uuid4().hex}"
    assert cs.load_checkpoint(out) is None
    assert cs.save_checkpoint(out, {"completed": ["a"], "n": 1}) == "mongodb"
    assert cs.load_checkpoint(out) == {"completed": ["a"], "n": 1}
    assert cs.save_checkpoint(out, {"completed": ["a", "b"]}) == "mongodb"
    assert cs.load_checkpoint(out) == {"completed": ["a", "b"]}
    other = tmp_path / f"run-{uuid.uuid4().hex}"
    assert cs.load_checkpoint(other) is None
    coll = local_mongo[AUDIT_DB].v8_campaign_checkpoints
    assert coll.count_documents({"namespace": cs.namespace_for(out)}) == 1


def test_claim_promotion_allows_exactly_one_writer(local_mongo, tmp_path):
    out = tmp_path / f"run-{uuid.uuid4().hex}"
    assert cs.claim_promotion(out, "harness-v1", "cand-a") is True
    assert cs.claim_promotion(out, "harness-v1", "cand-b") is False
    assert cs.claim_promotion(out, "cand-a", "cand-c") is True
    doc = local_mongo[AUDIT_DB].v8_active_pointers.find_one({"namespace": cs.namespace_for(out)})
    assert doc["active_version_id"] == "cand-c"
    assert local_mongo[AUDIT_DB].v8_active_pointers.count_documents({}) == 1


def test_unreachable_mongo_falls_back(monkeypatch, tmp_path):
    monkeypatch.setenv("MONGODB_URI", "mongodb://127.0.0.1:1")
    monkeypatch.setenv("MONGODB_DATABASE", AUDIT_DB)
    assert cs.save_checkpoint(tmp_path, {"completed": []}) == "file"
    assert cs.load_checkpoint(tmp_path) is None
    assert cs.claim_promotion(tmp_path, "p", "c") is False


def test_integration_status_values_match_names():
    assert {s.value for s in IntegrationStatus} == {s.name for s in IntegrationStatus}
    assert IntegrationStatus("NOT_CONFIGURED") is IntegrationStatus.NOT_CONFIGURED
    assert IntegrationStatus.INSTALLED_UNCONFIGURED.value == "INSTALLED_UNCONFIGURED"


def test_receipt_contract_shape_and_enums():
    fields = dict(
        receipt_id="r",
        run_id="run",
        parent_version_id="p",
        candidate_version_id="c",
        optimizer_provenance="DETERMINISTIC",
        promoted=False,
        decision_reason="x",
        parent_passed=1,
        parent_total=2,
        candidate_passed=2,
        candidate_total=2,
        false_positive_count=0,
        negative_control_count=1,
        holdout_case_ids=["h"],
        adjudication="AGREE_PASS",
        reference_artifact_sha256="0" * 64,
        configuration_hashes={},
        raindrop_status="NOT_CONFIGURED",
        elevenlabs_status="NOT_CONFIGURED",
    )
    receipt = EvidenceReceiptV8(**fields)
    assert receipt.optimizer_provenance is OptimizerProvenance.DETERMINISTIC
    assert receipt.adjudication is Adjudication.AGREE_PASS
    assert receipt.fingerprint_sha256 == ""
    with pytest.raises(ValueError):
        EvidenceReceiptV8(**{**fields, "optimizer_provenance": "NOPE"})
    del fields["run_id"]
    with pytest.raises(ValueError):
        EvidenceReceiptV8(**fields)


def test_checkpoint_paths_are_resolved_not_relative(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    Path("rel").mkdir()
    assert cs.namespace_for(Path("rel")) == cs.namespace_for(tmp_path / "rel")
