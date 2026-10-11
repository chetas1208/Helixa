import stat
from pathlib import Path

import pytest

from services.integrations.ebi_vcf.validator import EbiVcfValidator

ROOT = Path(__file__).resolve().parents[2]
FASTA = ROOT / "fixtures/references/ref_synthetic_chr22.fasta"
VALID_VCF = ROOT / "fixtures/valid/valid_snvs.vcf"
UNSUPPORTED_CONTIG_VCF = ROOT / "fixtures/invalid/unsupported_contig.vcf"

pytestmark = pytest.mark.skipif(
    not EbiVcfValidator().is_available(), reason="pinned EBI binaries not available"
)


class _FakeAssembly(EbiVcfValidator):
    """Real syntax validator, scripted assembly checker (checksum pin bypassed)."""

    def checksums_match(self):
        return True, "test"


def _fake_assembly(tmp_path: Path, body: str) -> _FakeAssembly:
    script = tmp_path / "fake_assembly_checker"
    script.write_text("#!/bin/sh\n" + body + "\n")
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return _FakeAssembly(assembly_path=script)


def _ref(tmp_path: Path) -> Path:
    ref = tmp_path / "ref.fasta"
    ref.write_text(">chr22\nACGT\n")
    return ref


def test_contig_absent_from_fasta_is_not_reported_as_concordant():
    report = EbiVcfValidator().validate(UNSUPPORTED_CONTIG_VCF, FASTA)
    assert report.assembly_valid is not True
    assert report.overall_status != "PASS"
    assert report.is_valid is False
    assert not any(c.check_id == "reference_allele_concordance" for c in report.checks)
    assert any(c.status == "FAIL" and "chr99" in c.message for c in report.checks)


def test_assembly_checker_crash_is_error_not_concordance(tmp_path: Path):
    val = _fake_assembly(tmp_path, "exit 139")
    report = val.validate(VALID_VCF, _ref(tmp_path))
    assert report.assembly_valid is None
    assert report.overall_status == "ERROR"
    assert report.is_valid is False
    assert not any(c.check_id == "reference_allele_concordance" for c in report.checks)


def test_real_checker_segfault_on_garbage_fasta_is_not_pass(tmp_path: Path):
    junk = tmp_path / "junk.fasta"
    junk.write_text("junk\n")
    (tmp_path / "junk.fasta.fai").write_text("junk\n")
    report = EbiVcfValidator().validate(VALID_VCF, junk)
    assert report.overall_status != "PASS"
    assert report.assembly_valid is not True
    assert report.is_valid is False


def test_unparseable_match_percentage_is_error(tmp_path: Path):
    val = _fake_assembly(tmp_path, 'echo "[info] Percentage of matches: -nan%" >&2; exit 1')
    report = val.validate(VALID_VCF, _ref(tmp_path))
    assert report.assembly_valid is None
    assert report.overall_status == "ERROR"
    assert report.is_valid is False


def test_match_percentage_on_stderr_below_100_is_fail(tmp_path: Path):
    # The EBI tools log to stderr; a sub-100% rate without parsable lines must still fail.
    val = _fake_assembly(tmp_path, 'echo "[info] Percentage of matches: 50%" >&2; exit 1')
    report = val.validate(VALID_VCF, _ref(tmp_path))
    assert report.assembly_valid is False
    assert report.overall_status == "FAIL"
    assert report.is_valid is False


def test_full_concordance_on_stderr_is_pass(tmp_path: Path):
    val = _fake_assembly(tmp_path, 'echo "[info] Percentage of matches: 100%" >&2; exit 0')
    report = val.validate(VALID_VCF, _ref(tmp_path))
    assert report.assembly_valid is True
    assert report.overall_status == "PASS"
    assert report.is_valid is True


def test_ref_mismatch_still_reported_with_locus():
    report = EbiVcfValidator().validate(ROOT / "fixtures/invalid/ref_mismatch.vcf", FASTA)
    assert report.assembly_valid is False
    mm = [c for c in report.checks if c.check_id == "reference_allele_mismatch"]
    assert mm and mm[0].locus == "chr22:105002"
