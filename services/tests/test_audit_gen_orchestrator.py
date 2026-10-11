from __future__ import annotations

from pathlib import Path

import pytest

from services.runtime.genomics.bcftools_adapter import BcftoolsAdapter
from services.runtime.genomics.contracts import CheckStatus
from services.runtime.genomics.orchestrator import DeterministicGenomicsOrchestrator

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
FASTA = FIXTURES / "references" / "ref_synthetic_chr22.fasta"
VALID_VCF = FIXTURES / "valid" / "valid_snvs.vcf"
MISMATCH_VCF = FIXTURES / "invalid" / "ref_mismatch.vcf"
ABSENT_VCF = FIXTURES / "invalid" / "absent_assembly.vcf"


def _orchestrator(tmp_path: Path) -> DeterministicGenomicsOrchestrator:
    return DeterministicGenomicsOrchestrator(cas_root=tmp_path / "cas", scratch_root=tmp_path / "scratch")


async def test_receipt_declared_reference_is_read_from_vcf_header(tmp_path):
    orch = _orchestrator(tmp_path)
    events: list[dict] = []
    _, receipt = await orch.execute_pipeline(VALID_VCF, FASTA, event_callback=events.append)
    assert receipt.declared_reference == "GRCh38"
    resolved = next(e for e in events if e["phase"] == "REFERENCE_RESOLVED")
    assert resolved["payload"]["declared_assembly"] == "GRCh38"


async def test_receipt_does_not_fabricate_declared_reference(tmp_path):
    orch = _orchestrator(tmp_path)
    events: list[dict] = []
    _, receipt = await orch.execute_pipeline(ABSENT_VCF, FASTA, event_callback=events.append)
    assert receipt.declared_reference is None
    resolved = next(e for e in events if e["phase"] == "REFERENCE_RESOLVED")
    assert resolved["payload"]["declared_assembly"] is None


async def test_receipt_declared_reference_reports_non_grch38_header(tmp_path):
    vcf = tmp_path / "grch37.vcf"
    vcf.write_text(
        "##fileformat=VCFv4.2\n##assembly=GRCh37\n##contig=<ID=chr22,length=120000>\n"
        "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n",
        encoding="utf-8",
    )
    _, receipt = await _orchestrator(tmp_path).execute_pipeline(vcf, FASTA)
    assert receipt.declared_reference == "GRCh37"


async def test_run_overall_status_mirrors_status(tmp_path):
    run, receipt = await _orchestrator(tmp_path).execute_pipeline(MISMATCH_VCF, FASTA)
    assert run.status == CheckStatus.FAIL
    assert run.overall_status == CheckStatus.FAIL
    assert receipt.overall_status == CheckStatus.FAIL
    assert run.model_dump(mode="json")["overall_status"] == "FAIL"


async def test_run_tool_traces_mirror_tool_receipts(tmp_path):
    run, _ = await _orchestrator(tmp_path).execute_pipeline(VALID_VCF, FASTA)
    assert run.tool_receipts
    assert [t.receipt_id for t in run.tool_traces] == [t.receipt_id for t in run.tool_receipts]


class _AsyncCallable:
    def __init__(self) -> None:
        self.events: list[dict] = []

    async def __call__(self, evt: dict) -> None:
        self.events.append(evt)


async def test_async_callable_object_callback_is_awaited(tmp_path):
    cb = _AsyncCallable()
    await _orchestrator(tmp_path).execute_pipeline(VALID_VCF, FASTA, event_callback=cb)
    assert [e["phase"] for e in cb.events] == [
        "INGESTED",
        "PARSED",
        "REFERENCE_RESOLVED",
        "STRUCTURE_CHECKED",
        "REF_CHECKED",
        "NORMALIZATION_CHECKED",
        "EVIDENCE_COMMITTED",
    ]


async def test_missing_bcftools_does_not_crash_pipeline(tmp_path):
    orch = _orchestrator(tmp_path)
    orch.bcftools_adapter = BcftoolsAdapter(
        bcftools_path=str(tmp_path / "no_such_dir" / "bcftools-missing"),
        scratch_dir=tmp_path / "scratch" / "bcftools",
    )
    orch.bcftools_adapter.bin_path = str(tmp_path / "no_such_dir" / "bcftools-missing")
    run, receipt = await orch.execute_pipeline(VALID_VCF, FASTA)
    assert run.status == CheckStatus.PASS
    assert receipt.derived_artifact_hashes == []
    assert run.derived_artifact_records == []


@pytest.mark.parametrize("bad_run_id", ["../../escape", "a/b", "a\\b", "x..y", "nul\x00byte"])
async def test_run_id_with_path_components_is_rejected(tmp_path, bad_run_id):
    orch = _orchestrator(tmp_path)
    with pytest.raises(ValueError):
        await orch.execute_pipeline(VALID_VCF, FASTA, run_id=bad_run_id)
    assert not (tmp_path / "scratch" / "normalized").exists()


async def test_default_reference_does_not_depend_on_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    run, receipt = await DeterministicGenomicsOrchestrator(
        cas_root=tmp_path / "cas", scratch_root=tmp_path / "scratch"
    ).execute_pipeline(VALID_VCF)
    assert receipt.selected_fasta_sha256 is not None
    assert run.status == CheckStatus.PASS


async def test_missing_vcf_raises_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        await _orchestrator(tmp_path).execute_pipeline(tmp_path / "nope.vcf", FASTA)


async def test_source_bytes_unchanged_and_derived_artifact_recorded(tmp_path):
    before = VALID_VCF.read_bytes()
    run, receipt = await _orchestrator(tmp_path).execute_pipeline(VALID_VCF, FASTA, run_id="run-audit-1")
    assert VALID_VCF.read_bytes() == before
    assert receipt.derived_artifact_hashes == [r.artifact_sha256 for r in run.derived_artifact_records]
    assert run.run_id == "run-audit-1"
    assert run.evidence_receipt_id == receipt.receipt_id


async def test_stream_pipeline_yields_all_phases_and_propagates_errors(tmp_path):
    orch = _orchestrator(tmp_path)
    phases = [e["phase"] async for e in orch.stream_pipeline(VALID_VCF, FASTA, run_id="run-audit-stream")]
    assert phases[0] == "INGESTED"
    assert phases[-1] == "EVIDENCE_COMMITTED"
    assert len(phases) == 7
    with pytest.raises(FileNotFoundError):
        async for _ in orch.stream_pipeline(tmp_path / "nope.vcf", FASTA):
            pass
