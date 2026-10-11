from __future__ import annotations

from services.runtime.harness import (
    HarnessStatus,
    PolicyEnvelope,
    create_candidate_mutation,
    get_baseline_harness,
)
from services.runtime.harness.models import HarnessSpec


def test_baseline_is_fresh_and_intentionally_deficient():
    a = get_baseline_harness()
    a.allowed_tools.append("tampered")
    a.metadata["x"] = 1
    b = get_baseline_harness()
    assert "tampered" not in b.allowed_tools
    assert "x" not in b.metadata
    assert b.status == HarnessStatus.BASELINE
    assert b.validation_policy.require_reference_allele_check is False
    assert b.parent_version_id is None


def test_mutation_does_not_alias_or_mutate_parent():
    parent = get_baseline_harness()
    before = parent.model_dump()
    child = create_candidate_mutation(parent)
    child.allowed_tools.append("x")
    child.validation_policy.require_normalization_check = False
    child.context_policy.max_context_items = 1
    child.execution_policy.max_attempts = 1
    assert parent.model_dump() == before
    assert child.parent_version_id == parent.version_id
    assert child.status == HarnessStatus.CANDIDATE
    assert child.metadata["parent_spec_hash"] == parent.compute_spec_hash()


def test_mutation_adds_tools_without_duplicates_and_stays_in_envelope():
    child = create_candidate_mutation(get_baseline_harness())
    assert len(child.allowed_tools) == len(set(child.allowed_tools))
    ok, _ = PolicyEnvelope().validate_candidate(child)
    assert ok is True
    again = create_candidate_mutation(child, version_id="harness-v3")
    assert len(again.allowed_tools) == len(set(again.allowed_tools))


def test_mutation_flags_off_inherit_parent_policy():
    parent = get_baseline_harness()
    child = create_candidate_mutation(parent, enable_ref_check=False, include_ref_meta=False)
    assert child.validation_policy == parent.validation_policy
    assert child.context_policy == parent.context_policy


def test_spec_hash_ignores_status_and_metadata_only():
    base = get_baseline_harness()
    h = base.compute_spec_hash()
    other = base.model_copy(deep=True)
    other.status = HarnessStatus.PROMOTED
    other.metadata["note"] = "changed"
    assert other.compute_spec_hash() == h
    other.version_id = "harness-other"
    assert other.compute_spec_hash() != h
    other = base.model_copy(deep=True)
    other.validation_policy.require_reference_allele_check = True
    assert other.compute_spec_hash() != h


def test_spec_hash_survives_json_round_trip():
    spec = create_candidate_mutation(get_baseline_harness())
    restored = HarnessSpec.model_validate(spec.model_dump(mode="json"))
    assert restored.compute_spec_hash() == spec.compute_spec_hash()
    assert restored.stable_version_id("r") == spec.stable_version_id("r")


def test_stable_version_id_is_content_addressed():
    parent = get_baseline_harness()
    a = create_candidate_mutation(parent, version_id="harness-a")
    b = create_candidate_mutation(parent, version_id="harness-b")
    b.metadata["noise"] = "x"
    b.status = HarnessStatus.REJECTED
    assert a.stable_version_id("role") == b.stable_version_id("role")
    assert a.stable_version_id("role").startswith("harness-v1-role-")
    assert a.stable_version_id("role") != a.stable_version_id("other")
    b.execution_policy.max_attempts += 1
    assert a.stable_version_id("role") != b.stable_version_id("role")
    assert parent.stable_version_id("r").startswith("harness-v1-r-")


def test_envelope_boundaries_are_inclusive_ceilings():
    env = PolicyEnvelope()
    spec = create_candidate_mutation(get_baseline_harness())
    spec.context_policy.max_context_items = env.max_context_items_limit
    spec.execution_policy.max_attempts = env.max_attempts_limit
    assert env.validate_candidate(spec)[0] is True
    spec.context_policy.max_context_items += 1
    ok, msg = env.validate_candidate(spec)
    assert ok is False and "Context items" in msg
    spec.context_policy.max_context_items = env.max_context_items_limit
    spec.execution_policy.max_attempts += 1
    ok, msg = env.validate_candidate(spec)
    assert ok is False and "Max attempts" in msg


def test_envelope_rejects_unlisted_tool_and_defaults_not_shared():
    env = PolicyEnvelope()
    spec = create_candidate_mutation(get_baseline_harness())
    spec.allowed_tools.append("run_shell")
    ok, msg = env.validate_candidate(spec)
    assert ok is False and "run_shell" in msg
    env.immutable_allowed_tools_whitelist.append("run_shell")
    assert "run_shell" not in PolicyEnvelope().immutable_allowed_tools_whitelist
