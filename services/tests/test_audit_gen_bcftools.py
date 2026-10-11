from __future__ import annotations

import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from services.runtime.genomics import bcftools_adapter as adapter_module
from services.runtime.genomics.bcftools_adapter import BcftoolsAdapter, UnsafeBcftoolsCommandError
from services.runtime.genomics.hasher import compute_sha256

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "fixtures"
FASTA_PATH = FIXTURES_DIR / "references" / "ref_synthetic_chr22.fasta"
INDEL_VCF = FIXTURES_DIR / "valid" / "normalization_indel.vcf"


@pytest.fixture
def fake_run(monkeypatch):
    calls: list[list[str]] = []

    def _run(cmd, **kwargs):
        calls.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(adapter_module.subprocess, "run", _run)
    return calls


@pytest.mark.parametrize(
    "args",
    [
        ["--check-ref", "s"],
        ["--check-ref=s"],
        ["-c", "s"],
        ["-cs"],
        ["--check", "s"],
        ["--check-r", "s"],
        ["--chec=s"],
        ["--check-ref", "ws"],
        ["--check-ref=es"],
        ["-c", "ws"],
        ["-cws"],
        ["-Dcs"],
        ["-D", "-ac", "s"],
        ["-m-any", "--fasta-ref", "ref.fa", "--check", "s", "in.vcf"],
    ],
)
def test_norm_rejects_every_spelling_of_check_ref_set(tmp_path, fake_run, args):
    adapter = BcftoolsAdapter(scratch_dir=tmp_path / "scratch")
    with pytest.raises(UnsafeBcftoolsCommandError):
        adapter._execute("norm", args, [])
    assert fake_run == []


@pytest.mark.parametrize(
    "args",
    [
        ["--check-ref", "e"],
        ["--check-ref=w"],
        ["-c", "x"],
        ["-cw"],
        ["--check", "e"],
        ["-m-any", "--fasta-ref", "/data/cs/ref.fa", "-o", "/data/s/out.vcf", "in.vcf"],
        ["-ocs", "in.vcf"],
        ["-f", "s", "in.vcf"],
        ["--no-version", "-N1000", "in.vcf"],
        ["-Ncs", "in.vcf"],
    ],
)
def test_norm_allows_legitimate_arguments(tmp_path, fake_run, args):
    adapter = BcftoolsAdapter(scratch_dir=tmp_path / "scratch")
    adapter._execute("norm", args, [])
    assert len(fake_run) == 1


def test_stats_collapse_argument_is_not_treated_as_check_ref(tmp_path, fake_run):
    adapter = BcftoolsAdapter(scratch_dir=tmp_path / "scratch")
    adapter._execute("stats", ["-c", "snps", "in.vcf"], [])
    assert len(fake_run) == 1


def test_normalize_refuses_output_path_equal_to_input_and_preserves_source(tmp_path):
    adapter = BcftoolsAdapter(scratch_dir=tmp_path / "scratch")
    vcf = tmp_path / "input.vcf"
    shutil.copyfile(INDEL_VCF, vcf)
    before = compute_sha256(vcf)

    with pytest.raises(ValueError):
        adapter.normalize(vcf, FASTA_PATH, vcf)

    assert compute_sha256(vcf) == before


def test_normalize_refuses_symlink_alias_of_input(tmp_path):
    adapter = BcftoolsAdapter(scratch_dir=tmp_path / "scratch")
    vcf = tmp_path / "input.vcf"
    shutil.copyfile(INDEL_VCF, vcf)
    alias = tmp_path / "alias.vcf"
    alias.symlink_to(vcf)
    before = compute_sha256(vcf)

    with pytest.raises(ValueError):
        adapter.normalize(vcf, FASTA_PATH, alias)

    assert compute_sha256(vcf) == before


def test_normalize_refuses_output_path_equal_to_reference(tmp_path):
    adapter = BcftoolsAdapter(scratch_dir=tmp_path / "scratch")
    fasta = tmp_path / "ref.fasta"
    shutil.copyfile(FASTA_PATH, fasta)
    shutil.copyfile(str(FASTA_PATH) + ".fai", str(fasta) + ".fai")
    before = compute_sha256(fasta)

    with pytest.raises(ValueError):
        adapter.normalize(INDEL_VCF, fasta, fasta)

    assert compute_sha256(fasta) == before


def test_normalize_still_writes_distinct_derived_artifact(tmp_path):
    adapter = BcftoolsAdapter(scratch_dir=tmp_path / "scratch")
    before = compute_sha256(INDEL_VCF)
    out = tmp_path / "out" / "derived.vcf"

    receipt, record = adapter.normalize(INDEL_VCF, FASTA_PATH, out)

    assert compute_sha256(INDEL_VCF) == before
    assert record.artifact_sha256 == compute_sha256(out)
    assert receipt.output_artifact_hashes == [record.artifact_sha256]
    assert record.parent_artifact_sha256 == before


def test_relative_bcftools_path_survives_scratch_cwd(tmp_path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "fakebcf"
    fake.write_text("#!/bin/sh\necho header-ok\n")
    fake.chmod(0o755)
    monkeypatch.chdir(tmp_path)

    adapter = BcftoolsAdapter(bcftools_path="bin/fakebcf", scratch_dir=tmp_path / "scratch")
    exit_code, stdout_str, _, _, receipt = adapter._execute("view", ["-h", "x.vcf"], [])

    assert exit_code == 0
    assert stdout_str.strip() == "header-ok"
    assert Path(receipt.argv[0]).is_absolute()


def test_source_mutation_invariant_is_not_an_assert_statement(tmp_path):
    script = textwrap.dedent(
        """
        import sys
        from pathlib import Path
        from services.runtime.genomics.bcftools_adapter import BcftoolsAdapter

        class Mutating(BcftoolsAdapter):
            def _execute(self, subcommand, args, input_paths):
                result = super()._execute(subcommand, args, input_paths)
                with open(input_paths[0], "ab") as fh:
                    fh.write(b"#tamper\\n")
                return result

        tmp = Path(sys.argv[1])
        adapter = Mutating(scratch_dir=tmp / "scratch")
        try:
            adapter.normalize(sys.argv[2], sys.argv[3], tmp / "out.vcf")
        except Exception as exc:
            print("RAISED", type(exc).__name__)
        else:
            print("SILENT")
        """
    )
    vcf = tmp_path / "input.vcf"
    shutil.copyfile(INDEL_VCF, vcf)
    env = {**os.environ, "PYTHONPATH": str(REPO_ROOT)}
    proc = subprocess.run(
        [sys.executable, "-O", "-c", script, str(tmp_path), str(vcf), str(FASTA_PATH)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.stdout.strip() == "RAISED RuntimeError", proc.stdout + proc.stderr
