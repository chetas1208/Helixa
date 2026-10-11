from __future__ import annotations

from pathlib import Path

import pysam

from services.runtime.genomics import CheckStatus, DeterministicGenomicsValidator

REPO_ROOT = Path(__file__).resolve().parents[2]
FASTA_PATH = REPO_ROOT / "fixtures" / "references" / "ref_synthetic_chr22.fasta"
MALFORMED_VCF = REPO_ROOT / "fixtures" / "invalid" / "malformed_record.vcf"

HEADER_BODY = (
    "##contig=<ID=chr22,length=117500>\n"
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n"
)


def _write_vcf(tmp_path: Path, name: str, header_extra: str, records: str) -> Path:
    path = tmp_path / name
    path.write_text("##fileformat=VCFv4.2\n" + header_extra + HEADER_BODY + records)
    return path


def _ref_base(pos: int) -> str:
    with pysam.FastaFile(str(FASTA_PATH)) as fasta:
        return fasta.fetch("chr22", pos - 1, pos)


def test_directory_path_yields_error_report_not_exception(tmp_path):
    report = DeterministicGenomicsValidator().validate(tmp_path, FASTA_PATH)

    assert report.overall_status == CheckStatus.ERROR
    assert any(f.check_id == "file_existence_check" and f.status == CheckStatus.ERROR for f in report.findings)


def test_assembly_declaration_requires_a_real_header_line(tmp_path):
    vcf = _write_vcf(
        tmp_path,
        "decoy_reference.vcf",
        '##INFO=<ID=X,Number=1,Type=String,Description="##reference=GRCh38">\n',
        f"chr22\t10001\t.\t{_ref_base(10001)}\tN\t.\t.\t.\n",
    )
    report = DeterministicGenomicsValidator().validate(vcf, FASTA_PATH)

    declared = [f for f in report.findings if f.check_id == "declared_assembly_check"]
    assert [f.status for f in declared] == [CheckStatus.WARNING]
    assert report.overall_status == CheckStatus.WARNING


def test_assembly_declaration_accepts_reference_and_assembly_lines(tmp_path):
    for idx, line in enumerate(("##reference=GRCh38\n", "##assembly=GRCh38\n")):
        vcf = _write_vcf(tmp_path, f"declared_{idx}.vcf", line, f"chr22\t10001\t.\t{_ref_base(10001)}\tN\t.\t.\t.\n")
        report = DeterministicGenomicsValidator().validate(vcf, FASTA_PATH)

        declared = [f for f in report.findings if f.check_id == "declared_assembly_check"]
        assert [f.status for f in declared] == [CheckStatus.PASS]


def test_zero_position_message_does_not_claim_length_overflow(tmp_path):
    vcf = _write_vcf(tmp_path, "pos_zero.vcf", "##reference=GRCh38\n", "chr22\t0\t.\tA\tG\t.\t.\t.\n")
    report = DeterministicGenomicsValidator().validate(vcf, FASTA_PATH)

    bounds = [f for f in report.findings if f.check_id == "contig_length_boundary_check"]
    assert len(bounds) == 1
    assert bounds[0].status == CheckStatus.FAIL
    assert "exceeds" not in bounds[0].message
    assert "0" in bounds[0].message


def test_position_past_contig_end_message_reports_overflow(tmp_path):
    vcf = _write_vcf(tmp_path, "pos_past_end.vcf", "##reference=GRCh38\n", "chr22\t117501\t.\tA\tG\t.\t.\t.\n")
    report = DeterministicGenomicsValidator().validate(vcf, FASTA_PATH)

    bounds = [f for f in report.findings if f.check_id == "contig_length_boundary_check"]
    assert len(bounds) == 1
    assert "exceeds contig 'chr22' length (117500)" in bounds[0].message


def test_fasta_handle_closed_when_vcf_is_unparseable(monkeypatch):
    real_fasta = pysam.FastaFile
    opened: list[_SpyFasta] = []

    class _SpyFasta:
        def __init__(self, path):
            self._inner = real_fasta(path)
            self.closed = False
            opened.append(self)

        def close(self):
            self.closed = True
            self._inner.close()

        def __getattr__(self, name):
            return getattr(self._inner, name)

    monkeypatch.setattr(pysam, "FastaFile", _SpyFasta)
    report = DeterministicGenomicsValidator().validate(MALFORMED_VCF, FASTA_PATH)

    assert report.overall_status == CheckStatus.ERROR
    assert any(f.check_id == "vcf_syntax_check" for f in report.findings)
    assert len(opened) == 1
    assert opened[0].closed


def test_ref_check_is_case_insensitive_and_flags_true_mismatch(tmp_path):
    base = _ref_base(10001)
    wrong = "A" if base != "A" else "C"
    ok_vcf = _write_vcf(tmp_path, "lower_ref.vcf", "##reference=GRCh38\n", f"chr22\t10001\t.\t{base.lower()}\tN\t.\t.\t.\n")
    bad_vcf = _write_vcf(tmp_path, "wrong_ref.vcf", "##reference=GRCh38\n", f"chr22\t10001\t.\t{wrong}\tN\t.\t.\t.\n")

    ok = DeterministicGenomicsValidator().validate(ok_vcf, FASTA_PATH)
    bad = DeterministicGenomicsValidator().validate(bad_vcf, FASTA_PATH)

    assert ok.overall_status == CheckStatus.PASS
    assert bad.overall_status == CheckStatus.FAIL
    mismatch = [f for f in bad.findings if f.check_id == "reference_ref_allele_match" and f.status == CheckStatus.FAIL]
    assert mismatch[0].metadata == {"declared_ref": wrong, "fasta_ref": base}


def test_validation_does_not_mutate_source_bytes_and_is_deterministic(tmp_path):
    vcf = _write_vcf(tmp_path, "stable.vcf", "##reference=GRCh38\n", f"chr22\t10001\t.\t{_ref_base(10001)}\tN\t.\t.\t.\n")
    before = vcf.read_bytes()

    first = DeterministicGenomicsValidator().validate(vcf, FASTA_PATH)
    second = DeterministicGenomicsValidator().validate(vcf, FASTA_PATH)

    assert vcf.read_bytes() == before
    assert [f.model_dump(mode="json") for f in first.findings] == [f.model_dump(mode="json") for f in second.findings]
    assert first.artifact_sha256 == second.artifact_sha256
