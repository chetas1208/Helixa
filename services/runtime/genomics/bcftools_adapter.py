from __future__ import annotations

import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from .contracts import ArtifactRecord, ToolExecutionReceipt
from .hasher import compute_sha256


class UnsafeBcftoolsCommandError(ValueError):
    """Raised when an unauthorized or dangerous bcftools flag is requested."""
    pass

class BcftoolsTimeoutError(TimeoutError):
    """Raised when bcftools execution exceeds safety budget."""
    pass

class BcftoolsAdapter:
    """
    Typed, allowlisted subprocess adapter for bcftools 1.24.
    Enforces strict argument lists (no shell=True), isolated working directories,
    time-bounded execution, and cryptographic receipts.
    Strictly forbids '--check-ref s' (silent reference mutation).
    """

    ALLOWED_SUBCOMMANDS = {"norm", "view", "stats", "index"}
    # bcftools norm short options that consume an argument (the rest of the token, or the next one).
    _NORM_SHORT_WITH_ARG = frozenset("cdefgimoOrRStTwv")
    _NORM_SHORT_OPTIONAL_ARG = frozenset("NW")
    TOOL_NAME = "bcftools"
    TOOL_VERSION = "1.24"

    def __init__(
        self,
        bcftools_path: str = "/home/923873155/.local/bin/bcftools",
        scratch_dir: str | Path = "artifacts/scratch/bcftools",
        default_timeout_sec: float = 15.0,
    ):
        self.bin_path = (
            os.path.abspath(bcftools_path)
            if Path(bcftools_path).exists()
            else shutil.which("bcftools") or "bcftools"
        )
        self.scratch_dir = Path(scratch_dir).resolve()
        self.scratch_dir.mkdir(parents=True, exist_ok=True)
        self.timeout_sec = default_timeout_sec

    @classmethod
    def _norm_sets_ref(cls, args: list[str]) -> bool:
        """True if norm args request '--check-ref' with a value containing 's', in any spelling getopt accepts."""
        idx = 0
        while idx < len(args):
            arg = args[idx]
            idx += 1
            if arg == "--":
                break
            if arg.startswith("--"):
                name, sep, value = arg.partition("=")
                if "--check-ref".startswith(name):
                    if not sep and idx < len(args):
                        value = args[idx]
                    if "s" in value.lower():
                        return True
            elif arg.startswith("-") and len(arg) > 1:
                for pos in range(1, len(arg)):
                    char = arg[pos]
                    if char in cls._NORM_SHORT_WITH_ARG:
                        value = arg[pos + 1 :]
                        if char == "c":
                            if not value and idx < len(args):
                                value = args[idx]
                            if "s" in value.lower():
                                return True
                        break
                    if char in cls._NORM_SHORT_OPTIONAL_ARG:
                        break
        return False

    def _execute(
        self,
        subcommand: str,
        args: list[str],
        input_paths: list[Path],
    ) -> tuple[int, str, str, float, ToolExecutionReceipt]:
        if subcommand not in self.ALLOWED_SUBCOMMANDS:
            raise UnsafeBcftoolsCommandError(f"bcftools subcommand '{subcommand}' is not in allowlist.")

        # Hard safety policy check: forbid silent REF modification flag
        for idx, arg in enumerate(args):
            if arg in ("--check-ref", "-c") and idx + 1 < len(args) and args[idx + 1] == "s":
                raise UnsafeBcftoolsCommandError(
                    "Forbidden flag '--check-ref s': Silent reference allele mutation is strictly prohibited."
                )
            if arg.startswith("--check-ref=s") or arg.startswith("-cs"):
                raise UnsafeBcftoolsCommandError(
                    "Forbidden flag '--check-ref s': Silent reference allele mutation is strictly prohibited."
                )

        if subcommand == "norm" and self._norm_sets_ref(args):
            raise UnsafeBcftoolsCommandError(
                "Forbidden flag '--check-ref s': Silent reference allele mutation is strictly prohibited."
            )

        full_cmd = [self.bin_path, subcommand, *args]
        input_hashes = [compute_sha256(p) for p in input_paths if p.exists()]

        start_time = time.perf_counter()
        now_str = datetime.now(timezone.utc).isoformat()

        try:
            res = subprocess.run(
                full_cmd,
                cwd=str(self.scratch_dir),
                capture_output=True,
                text=True,
                timeout=self.timeout_sec,
                env={"LC_ALL": "C", "PATH": os.environ.get("PATH", "")},
            )
            runtime_ms = (time.perf_counter() - start_time) * 1000
            exit_code = res.returncode
            stdout_str = res.stdout
            stderr_str = res.stderr
        except subprocess.TimeoutExpired as e:
            runtime_ms = (time.perf_counter() - start_time) * 1000
            raise BcftoolsTimeoutError(
                f"bcftools {subcommand} timed out after {self.timeout_sec}s: {e}"
            ) from e

        receipt_id = f"rcpt-bcf-{int(datetime.now().timestamp() * 1000)}"
        receipt = ToolExecutionReceipt(
            receipt_id=receipt_id,
            tool_name=self.TOOL_NAME,
            tool_version=self.TOOL_VERSION,
            argv=full_cmd,
            exit_code=exit_code,
            input_hashes=input_hashes,
            output_artifact_hashes=[],
            stdout_summary=stdout_str[:1000],
            stderr_summary=stderr_str[:1000],
            runtime_ms=runtime_ms,
            timestamp=now_str,
        )

        return exit_code, stdout_str, stderr_str, runtime_ms, receipt

    def check_ref(
        self,
        vcf_path: str | Path,
        fasta_path: str | Path,
    ) -> ToolExecutionReceipt:
        """
        Executes read-only reference checking using '--check-ref e'.
        Exits with non-zero status if REF allele mismatches selected reference FASTA.
        """
        v_path = Path(vcf_path).resolve()
        f_path = Path(fasta_path).resolve()
        dev_null = "/dev/null"

        args = ["--check-ref", "e", "--fasta-ref", str(f_path), "-o", dev_null, str(v_path)]
        _, _, _, _, receipt = self._execute("norm", args, [v_path, f_path])
        return receipt

    def normalize(
        self,
        vcf_path: str | Path,
        fasta_path: str | Path,
        output_path: str | Path,
    ) -> tuple[ToolExecutionReceipt, ArtifactRecord]:
        """
        Non-destructive normalization: splits multi-allelics and left-aligns indels.
        Writes to a separate derived artifact. The original source file remains byte-identical.
        """
        v_path = Path(vcf_path).resolve()
        f_path = Path(fasta_path).resolve()
        out_path = Path(output_path).resolve()
        for protected in (v_path, f_path):
            if out_path == protected or (out_path.exists() and protected.exists() and out_path.samefile(protected)):
                raise ValueError(f"Normalization output path must not alias input file: {protected}")
        out_path.parent.mkdir(parents=True, exist_ok=True)

        original_hash_before = compute_sha256(v_path)

        args = ["-m-any", "--fasta-ref", str(f_path), "-o", str(out_path), str(v_path)]
        exit_code, stdout_str, stderr_str, _, receipt = self._execute("norm", args, [v_path, f_path])

        if exit_code != 0:
            raise RuntimeError(f"bcftools normalization failed (exit code {exit_code}): {stderr_str}")

        if not out_path.exists() or out_path.stat().st_size == 0:
            if stdout_str:
                out_path.write_text(stdout_str, encoding="utf-8")

        # Invariant check: verify original input file was NOT mutated
        original_hash_after = compute_sha256(v_path)
        if original_hash_before != original_hash_after:
            raise RuntimeError("Original VCF was corrupted by normalization!")

        derived_hash = compute_sha256(out_path)
        receipt.output_artifact_hashes.append(derived_hash)

        now_str = datetime.now(timezone.utc).isoformat()
        derived_record = ArtifactRecord(
            artifact_id=f"art-norm-{derived_hash[:12]}",
            artifact_sha256=derived_hash,
            filename=out_path.name,
            file_format="vcf",
            byte_size=out_path.stat().st_size,
            is_compressed=False,
            is_derived=True,
            parent_artifact_sha256=original_hash_before,
            storage_path=str(out_path),
            storage_backend="local_cas",
            created_at=now_str,
            metadata={"transformation": "bcftools_norm_split_and_left_align"},
        )

        return receipt, derived_record

    def view_header(self, vcf_path: str | Path) -> tuple[str, ToolExecutionReceipt]:
        v_path = Path(vcf_path).resolve()
        exit_code, stdout_str, stderr_str, _, receipt = self._execute("view", ["-h", str(v_path)], [v_path])
        if exit_code != 0:
            raise RuntimeError(f"bcftools view -h failed: {stderr_str}")
        return stdout_str, receipt
