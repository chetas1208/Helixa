import pytest
from pymongo import ReturnDocument

from services.integrations.contracts import GenomicIncident
from services.integrations.mongodb import MongoDBClient
from services.runtime.evaluation.holdout import (
    HoldoutLeakError,
    assert_proposer_inputs_exclude_holdout,
)
from services.runtime.evolution.gepa_adapter import gepa_package_status
from services.runtime.evolution.optimizer_registry import scheduler_status
from services.runtime.evolution.search_adapter import MetaHarnessSearchAdapter
from services.runtime.harness.baseline import get_baseline_harness
from services.runtime.harness.models import PolicyEnvelope


def _incident() -> GenomicIncident:
    return GenomicIncident(
        incident_id="synthetic-ref-mismatch",
        run_id="v8-test",
        dataset_sha256="abc",
        reference_sha256="def",
        failing_check="reference_allele_mismatch",
        error_signature="REF allele does not match",
    )


def test_candidate_ids_are_stable_across_runs():
    parent = get_baseline_harness()
    first = MetaHarnessSearchAdapter().generate_candidates(parent, _incident(), max_candidates=3)
    second = MetaHarnessSearchAdapter().generate_candidates(parent, _incident(), max_candidates=3)
    assert [spec.version_id for spec, _patch in first] == [spec.version_id for spec, _patch in second]


def test_search_repairs_ref_policy_and_labels_provenance_honestly():
    parent = get_baseline_harness()
    patches = MetaHarnessSearchAdapter().generate_candidates(parent, _incident(), max_candidates=3)
    assert patches
    assert all(patch.optimizer_source == "DETERMINISTIC" for _spec, patch in patches)
    assert any(spec.validation_policy.require_reference_allele_check for spec, _patch in patches)


def test_unsafe_tool_is_rejected_before_evaluation():
    parent = get_baseline_harness()
    unsafe = parent.model_copy(deep=True)
    unsafe.allowed_tools = [*parent.allowed_tools, "execute_shell"]
    ok, reason = PolicyEnvelope().validate_candidate(unsafe)
    assert ok is False
    assert "execute_shell" in reason


def test_holdout_ids_cannot_reach_the_proposer():
    with pytest.raises(HoldoutLeakError):
        assert_proposer_inputs_exclude_holdout(["heldout_transfer_unseen_mismatch"], [])


def test_gepa_package_is_installed_and_not_a_live_optimizer():
    status, detail = gepa_package_status()
    assert status == "INSTALLED_UNCONFIGURED"
    assert "optimize()" in detail
    status_row = scheduler_status()
    assert status_row["primary_proposer"] == "DETERMINISTIC"
    assert status_row["meta_harness_imported"] is False
    assert status_row["gepa_status"] == "INSTALLED_UNCONFIGURED"


@pytest.mark.asyncio
async def test_duplicate_promotion_pointer_allows_one_writer():
    client = MongoDBClient()
    namespace = "v8-pointer-test"
    await client.db.v8_active_pointers.delete_many({"namespace": namespace})
    await client.db.v8_active_pointers.insert_one({"namespace": namespace, "active_version_id": "harness-v1"})
    first = await client.db.v8_active_pointers.find_one_and_update(
        {"namespace": namespace, "active_version_id": "harness-v1"},
        {"$set": {"active_version_id": "harness-v1-repair"}},
        return_document=ReturnDocument.AFTER,
    )
    second = await client.db.v8_active_pointers.find_one_and_update(
        {"namespace": namespace, "active_version_id": "harness-v1"},
        {"$set": {"active_version_id": "harness-v1-unsafe"}},
        return_document=ReturnDocument.AFTER,
    )
    assert first is not None
    assert first["active_version_id"] == "harness-v1-repair"
    assert second is None
    await client.db.v8_active_pointers.delete_many({"namespace": namespace})
    await client.close()
