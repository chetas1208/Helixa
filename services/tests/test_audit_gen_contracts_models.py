from __future__ import annotations

import copy

from services.runtime.genomics import (
    CheckStatus,
    ToolExecutionReceipt,
    ValidationFinding,
    ValidationRun,
    contracts,
    models,
)


def test_validation_run_status_assignment_keeps_overall_status_in_sync():
    run = ValidationRun(run_id="run-audit-1", status=CheckStatus.PASS)
    run.status = CheckStatus.FAIL
    assert run.overall_status == CheckStatus.FAIL
    dumped = run.model_dump(mode="json")
    assert dumped["status"] == "FAIL"
    assert dumped["overall_status"] == "FAIL"


def test_validation_run_overall_status_assignment_keeps_status_in_sync():
    run = ValidationRun(run_id="run-audit-2")
    run.overall_status = CheckStatus.ERROR
    assert run.status == CheckStatus.ERROR


def test_validation_run_tool_receipt_mutation_is_visible_in_tool_traces():
    run = ValidationRun(run_id="run-audit-3")
    receipt = ToolExecutionReceipt(tool_name="bcftools", tool_version="1.24", argv=["view", "-h"])
    run.tool_receipts.append(receipt)
    run.tool_receipts.extend([receipt])
    dumped = run.model_dump(mode="json")
    assert len(dumped["tool_receipts"]) == 2
    assert dumped["tool_traces"] == dumped["tool_receipts"]


def test_validation_run_tool_receipts_assignment_keeps_tool_traces_in_sync():
    run = ValidationRun(run_id="run-audit-4")
    receipt = ToolExecutionReceipt(tool_name="pysam", tool_version="0.24.1")
    run.tool_receipts = [receipt]
    assert [r.receipt_id for r in run.tool_traces] == [receipt.receipt_id]
    run.tool_traces = []
    assert run.tool_receipts == []


def test_validation_run_roundtrip_and_copy_keep_aliases_consistent():
    run = ValidationRun(run_id="run-audit-5", status=CheckStatus.WARNING)
    run.tool_receipts.append(ToolExecutionReceipt(tool_name="t", tool_version="1"))
    restored = ValidationRun.model_validate(run.model_dump(mode="json"))
    restored.tool_receipts.append(ToolExecutionReceipt(tool_name="u", tool_version="2"))
    restored.status = CheckStatus.FAIL
    assert len(restored.tool_traces) == 2
    assert restored.overall_status == CheckStatus.FAIL
    clone = copy.deepcopy(restored)
    clone.tool_traces.append(ToolExecutionReceipt(tool_name="v", tool_version="3"))
    assert len(clone.tool_receipts) == 3
    assert len(restored.tool_receipts) == 2


def test_validation_run_alias_construction_still_works():
    by_legacy = ValidationRun(overall_status=CheckStatus.FAIL, artifact_sha256="a" * 64)
    assert by_legacy.status == CheckStatus.FAIL
    assert by_legacy.target_artifact_sha256 == "a" * 64
    receipt = ToolExecutionReceipt(tool_name="t", tool_version="1")
    by_traces = ValidationRun(tool_traces=[receipt])
    assert len(by_traces.tool_receipts) == 1


def test_finding_and_receipt_legacy_aliases_unchanged():
    finding = ValidationFinding(check_id="X", artifact_id="art-1", evidence_ids=["e1"])
    assert finding.source_artifact_sha256 == "art-1"
    assert finding.evidence_pointers == ["e1"]
    receipt = ToolExecutionReceipt(tool_name="t", tool_version="1", args=["a"], stdout_snippet="out")
    assert receipt.argv == ["a"]
    assert receipt.stdout_summary == "out"


def test_models_module_reexports_contract_classes():
    assert models.ValidationReport is contracts.ValidationRun
    assert models.Finding is contracts.ValidationFinding
    assert models.ToolTrace is contracts.ToolExecutionReceipt
    assert models.LocusInfo is contracts.LocusCoordinate
