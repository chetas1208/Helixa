"""Audit tests for services/integrations/biomni (unit int_biomni)."""

from __future__ import annotations

import os
import threading
from pathlib import Path

from services.integrations.biomni.adapter import BiomniToolAdapter
from services.integrations.contracts import ToolInvocationRequest

VCF_HEADER = "##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n"


def _write_vcf(path: Path, records: list[str]) -> Path:
    path.write_text(VCF_HEADER + "".join(records), encoding="utf-8")
    return path


def _stats(adapter: BiomniToolAdapter, path: Path | str):
    return adapter.invoke(
        ToolInvocationRequest(tool_id="biomni_vcf_stats_inspector", artifact_id_or_path=str(path))
    )


def test_symlink_input_is_rejected(tmp_path: Path) -> None:
    real = _write_vcf(tmp_path / "real.vcf", ["chr1\t10\t.\tA\tG\t.\t.\t.\n"])
    link = tmp_path / "link.vcf"
    os.symlink(real, link)
    result = _stats(BiomniToolAdapter(), link)
    assert result.status == "ERROR"
    assert result.exit_code == 126
    assert "symlink" in result.stderr


def test_regular_file_still_succeeds(tmp_path: Path) -> None:
    real = _write_vcf(tmp_path / "real.vcf", ["chr1\t10\t.\tA\tG\t.\t.\t.\n"])
    result = _stats(BiomniToolAdapter(), real)
    assert result.status == "SUCCESS"
    assert result.findings[0]["transitions"] == 1


def test_fifo_input_is_rejected_without_blocking(tmp_path: Path) -> None:
    fifo = tmp_path / "pipe.vcf"
    os.mkfifo(fifo)
    outcome: dict = {}

    def run() -> None:
        outcome["result"] = _stats(BiomniToolAdapter(), fifo)

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(timeout=3)
    blocked = worker.is_alive()
    if blocked:
        # Release the blocked open() so the thread can finish.
        fd = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
        os.close(fd)
        worker.join(timeout=3)
    assert not blocked, "adapter blocked opening a non-regular file"
    assert outcome["result"].status == "ERROR"
    assert outcome["result"].exit_code == 2


def test_directory_input_is_rejected_as_not_a_file(tmp_path: Path) -> None:
    result = _stats(BiomniToolAdapter(), tmp_path)
    assert result.status == "ERROR"
    assert result.exit_code == 2
    assert "not a regular file" in result.stderr


def test_explicit_allowed_workspaces_are_enforced(tmp_path: Path) -> None:
    inside = tmp_path / "inside"
    outside = tmp_path / "outside"
    inside.mkdir()
    outside.mkdir()
    allowed_file = _write_vcf(inside / "a.vcf", ["chr1\t10\t.\tA\tG\t.\t.\t.\n"])
    other_file = _write_vcf(outside / "b.vcf", ["chr1\t10\t.\tA\tG\t.\t.\t.\n"])
    adapter = BiomniToolAdapter(allowed_workspaces=[inside])
    assert _stats(adapter, allowed_file).status == "SUCCESS"
    denied = _stats(adapter, other_file)
    assert denied.status == "ERROR"
    assert denied.exit_code == 126
    assert "SECURITY_VIOLATION" in denied.stderr


def test_default_adapter_does_not_restrict_workspace(tmp_path: Path) -> None:
    other_file = _write_vcf(tmp_path / "b.vcf", ["chr1\t10\t.\tA\tG\t.\t.\t.\n"])
    assert _stats(BiomniToolAdapter(), other_file).status == "SUCCESS"


def test_alt_missing_value_is_not_counted_as_snv(tmp_path: Path) -> None:
    vcf = _write_vcf(
        tmp_path / "dot.vcf",
        ["chr1\t10\t.\tA\t.\t.\t.\t.\n", "chr1\t20\t.\tA\tG\t.\t.\t.\n"],
    )
    finding = _stats(BiomniToolAdapter(), vcf).findings[0]
    assert finding["total_records"] == 2
    assert finding["snv_count"] == 1
    assert finding["indel_count"] == 0
    assert finding["transitions"] == 1


def test_tuple_arguments_are_scanned_for_forbidden_tokens(tmp_path: Path) -> None:
    vcf = _write_vcf(tmp_path / "t.vcf", ["chr1\t10\t.\tA\tG\t.\t.\t.\n"])
    result = BiomniToolAdapter().invoke(
        ToolInvocationRequest(
            tool_id="biomni_vcf_stats_inspector",
            artifact_id_or_path=str(vcf),
            arguments={"note": ("os.system('x')",)},
        )
    )
    assert result.status == "ERROR"
    assert result.exit_code == 126


def test_path_traversal_and_null_byte_rejected(tmp_path: Path) -> None:
    adapter = BiomniToolAdapter()
    assert _stats(adapter, "a/../b.vcf").exit_code == 126
    assert _stats(adapter, "a\x00.vcf").exit_code == 126


def test_unknown_tool_is_error() -> None:
    result = BiomniToolAdapter().invoke(
        ToolInvocationRequest(tool_id="nope", artifact_id_or_path="x.vcf")
    )
    assert result.status == "ERROR"
    assert result.exit_code == 1


def test_gz_vcf_stats_and_region_overlap(tmp_path: Path) -> None:
    import gzip

    gz = tmp_path / "x.vcf.gz"
    with gzip.open(gz, "wt") as handle:
        handle.write(VCF_HEADER + "chr1\t10\t.\tA\tG\t.\t.\t.\nchr1\t50\t.\tC\tA\t.\t.\t.\n")
    adapter = BiomniToolAdapter()
    stats = _stats(adapter, gz).findings[0]
    assert (stats["transitions"], stats["transversions"], stats["titv_ratio"]) == (1, 1, 1.0)
    overlap = adapter.invoke(
        ToolInvocationRequest(
            tool_id="biomni_genomic_region_overlap",
            artifact_id_or_path=str(gz),
            arguments={"regions": ["chr1:1-10", "bad", "chr2:1-100"]},
        )
    ).findings[0]
    assert overlap["overlapping_variants"] == 1
    assert overlap["target_regions_checked"] == 2


def test_region_overlap_without_valid_regions_is_inconclusive(tmp_path: Path) -> None:
    vcf = _write_vcf(tmp_path / "r.vcf", ["chr1\t10\t.\tA\tG\t.\t.\t.\n"])
    finding = BiomniToolAdapter().invoke(
        ToolInvocationRequest(
            tool_id="biomni_genomic_region_overlap",
            artifact_id_or_path=str(vcf),
            arguments={"regions": ["nonsense"]},
        )
    ).findings[0]
    assert finding["status"] == "INCONCLUSIVE"
    assert finding["overlapping_variants"] == 0


def test_liftover_without_chain_is_inconclusive(tmp_path: Path) -> None:
    vcf = _write_vcf(tmp_path / "l.vcf", ["chr1\t10\t.\tA\tG\t.\t.\t.\n"])
    result = BiomniToolAdapter().invoke(
        ToolInvocationRequest(
            tool_id="biomni_reference_coordinate_liftover",
            artifact_id_or_path=str(vcf),
            arguments={"source_assembly": "GRCh37", "target_assembly": "GRCh38"},
        )
    )
    assert result.status == "SUCCESS"
    assert result.findings[0]["status"] == "INCONCLUSIVE"
    assert result.findings[0]["chain_available"] is False
