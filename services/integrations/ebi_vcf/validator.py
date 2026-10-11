from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from services.integrations.contracts import ScientificCheckResult
from services.runtime.v8.contracts import IntegrationStatus


def integration_status() -> tuple[IntegrationStatus, str]:
    val = EbiVcfValidator()
    if val.is_available():
        return (
            IntegrationStatus.CONNECTED,
            f"EBI VCF validator v{val.get_version()} available and verified",
        )
    return (
        IntegrationStatus.INSTALLED_UNCONFIGURED,
        "EBI VCF validator binary not found or not executable",
    )


class EbiValidationReport(BaseModel):

    is_valid: bool
    overall_status: str  # PASS, FAIL, ERROR
    checks: list[ScientificCheckResult] = Field(default_factory=list)
    total_errors: int = 0
    total_warnings: int = 0
    syntax_valid: bool = False
    assembly_valid: bool | None = None
    runtime_ms: float = 0.0
    raw_validator_stdout: str = ""
    raw_assembly_stdout: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class EbiVcfValidator:
    """
    Adapter wrapping official native EBI VCF Validator (vcf_validator_linux)
    and EBI VCF Assembly Checker (vcf_assembly_checker_linux).
    Executes in isolated scratch directories with strict timeouts and resource limits.
    """

    DEFAULT_VALIDATOR_PATH = Path("third_party/ebi-vcf-validator/v0.10.2/vcf_validator_linux")
    DEFAULT_ASSEMBLY_PATH = Path("third_party/ebi-vcf-validator/v0.10.2/vcf_assembly_checker_linux")
    PINNED_SHA256 = {
        "vcf_validator_linux": "7326fc83425f5367f9974aaa223f2b48b1854bf9ecd5e9e5eae3899b3107fc87",
        "vcf_assembly_checker_linux": "c356ffa12a84053fd690b794820a192d47c35d0e6668f502e06d6b99a417bfc3",
    }

    def __init__(
        self,
        validator_path: str | Path | None = None,
        assembly_path: str | Path | None = None,
        timeout_seconds: float = 25.0,
    ):
        self.validator_path = self._resolve_binary(validator_path or self.DEFAULT_VALIDATOR_PATH, "vcf_validator_linux")
        self.assembly_path = self._resolve_binary(assembly_path or self.DEFAULT_ASSEMBLY_PATH, "vcf_assembly_checker_linux")
        self.timeout_seconds = timeout_seconds

    def _resolve_binary(self, binary_path: str | Path, fallback_name: str) -> Path:
        p = Path(binary_path).resolve()
        if p.exists() and os.access(p, os.X_OK):
            return p
        # Check PATH fallback
        which_path = shutil.which(fallback_name)
        if which_path:
            return Path(which_path).resolve()
        return p

    def is_available(self) -> bool:
        ok, _detail = self.checksums_match()
        return ok

    def checksums_match(self) -> tuple[bool, str]:
        for path in (self.validator_path, self.assembly_path):
            expected = self.PINNED_SHA256.get(path.name)
            if expected is None or not path.is_file():
                return False, f"Missing pinned binary {path}"
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != expected:
                return False, f"Checksum mismatch for {path.name}"
        return True, "pinned v0.10.2 checksums match"

    def get_version(self) -> str:
        if not self.is_available():
            return "unavailable"
        try:
            res = subprocess.run(
                [str(self.validator_path), "--version"],
                capture_output=True,
                text=True,
                timeout=5.0,
                check=False,
            )
            # Output format: "vcf_validator version 0.10.2"
            m = re.search(r"version\s+([0-9\.]+)", res.stdout)
            if m:
                return m.group(1)
            return res.stdout.strip() or "0.10.2"
        except Exception:
            return "unknown"

    def validate(
        self,
        vcf_path: str | Path,
        fasta_path: str | Path | None = None,
        validation_level: str = "warning",
    ) -> EbiValidationReport:
        start_time = time.perf_counter()
        vcf_file = Path(vcf_path).resolve()

        if not vcf_file.exists():
            return EbiValidationReport(
                is_valid=False,
                overall_status="ERROR",
                checks=[
                    ScientificCheckResult(
                        validator_id="ebi_vcf_validator",
                        tool_version=self.get_version(),
                        status="ERROR",
                        check_id="file_existence_check",
                        message=f"Target VCF not found at: {vcf_file}",
                    )
                ],
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )

        if not self.is_available():
            return EbiValidationReport(
                is_valid=False,
                overall_status="ERROR",
                checks=[
                    ScientificCheckResult(
                        validator_id="ebi_vcf_validator",
                        tool_version="unavailable",
                        status="ERROR",
                        check_id="binary_availability_check",
                        message=f"EBI validator binary not executable at {self.validator_path}",
                    )
                ],
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )

        checks: list[ScientificCheckResult] = []
        tool_version = self.get_version()

        with tempfile.TemporaryDirectory(prefix="ebi_val_") as tmp_dir:
            out_dir = Path(tmp_dir)

            # Phase 1: Run Syntax / Specification Validator
            val_cmd = [
                str(self.validator_path),
                "-i",
                str(vcf_file),
                "-l",
                validation_level,
                "-r",
                "summary,text",
                "-o",
                str(out_dir),
            ]

            try:
                val_res = subprocess.run(
                    val_cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_seconds,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                return EbiValidationReport(
                    is_valid=False,
                    overall_status="ERROR",
                    checks=[
                        ScientificCheckResult(
                            validator_id="ebi_vcf_validator",
                            tool_version=tool_version,
                            status="ERROR",
                            check_id="execution_timeout_check",
                            message=f"EBI validator timed out after {self.timeout_seconds} seconds",
                        )
                    ],
                    runtime_ms=(time.perf_counter() - start_time) * 1000,
                )
            except Exception as e:
                return EbiValidationReport(
                    is_valid=False,
                    overall_status="ERROR",
                    checks=[
                        ScientificCheckResult(
                            validator_id="ebi_vcf_validator",
                            tool_version=tool_version,
                            status="ERROR",
                            check_id="subprocess_invocation_check",
                            message=f"Failed to execute EBI validator: {e!s}",
                        )
                    ],
                    runtime_ms=(time.perf_counter() - start_time) * 1000,
                )

            validator_stdout = val_res.stdout
            validator_stderr = val_res.stderr

            # Parse validator report files
            error_files = list(out_dir.glob("*.errors.*.txt"))
            summary_files = list(out_dir.glob("*.errors_summary.*.txt"))

            parsed_errors: list[str] = []
            if error_files:
                try:
                    with open(error_files[0], "r", encoding="utf-8", errors="replace") as f:
                        for line in f:
                            stripped = line.strip()
                            if stripped and not stripped.startswith("According to the VCF specification"):
                                parsed_errors.append(stripped)
                except Exception:
                    pass

            is_syntax_valid = "According to the VCF specification, the input file is valid" in validator_stdout
            syntax_declared_invalid = "According to the VCF specification, the input file is not valid" in validator_stdout

            if summary_files:
                try:
                    with open(summary_files[0], "r", encoding="utf-8", errors="replace") as f:
                        summary_txt = f.read()
                        if "the input file is valid" in summary_txt:
                            is_syntax_valid = True
                        elif "the input file is not valid" in summary_txt:
                            syntax_declared_invalid = True
                except Exception:
                    pass

            if syntax_declared_invalid:
                is_syntax_valid = False

            if is_syntax_valid:
                checks.append(
                    ScientificCheckResult(
                        validator_id="ebi_vcf_validator",
                        tool_version=tool_version,
                        status="PASS",
                        check_id="vcf_specification_compliance",
                        message="According to the EBI VCF specification validator, the input file is valid.",
                    )
                )
            else:
                if not parsed_errors:
                    parsed_errors.append(validator_stdout.strip() or validator_stderr.strip() or "VCF specification check failed.")

                for err in parsed_errors:
                    line_num: int | None = None
                    m = re.search(r"Line\s+(\d+):", err)
                    if m:
                        line_num = int(m.group(1))

                    checks.append(
                        ScientificCheckResult(
                            validator_id="ebi_vcf_validator",
                            tool_version=tool_version,
                            status="FAIL",
                            check_id="vcf_format_error",
                            message=err,
                            details={"line_number": line_num} if line_num else {},
                        )
                    )

            # Phase 2: Assembly Checker (if FASTA provided and assembly checker binary available)
            assembly_valid: bool | None = None
            assembly_stdout: str | None = None

            if fasta_path and Path(fasta_path).exists() and self.assembly_path.exists() and os.access(self.assembly_path, os.X_OK):
                fasta_file = Path(fasta_path).resolve()
                asm_cmd = [
                    str(self.assembly_path),
                    "-i",
                    str(vcf_file),
                    "-f",
                    str(fasta_file),
                    "-r",
                    "summary,text",
                    "-o",
                    str(out_dir),
                ]

                try:
                    asm_res = subprocess.run(
                        asm_cmd,
                        capture_output=True,
                        text=True,
                        timeout=self.timeout_seconds,
                        check=False,
                    )
                    assembly_stdout = asm_res.stdout
                    asm_log = f"{asm_res.stdout}\n{asm_res.stderr}"

                    # Parse assembly report
                    asm_reports = list(out_dir.glob("*.text_assembly_report.*.txt"))
                    asm_mismatches: list[dict[str, Any]] = []
                    asm_other_findings: list[str] = []

                    if asm_reports:
                        with open(asm_reports[0], "r", encoding="utf-8", errors="replace") as f:
                            for line in f:
                                stripped = line.strip()
                                if not stripped:
                                    continue
                                # E.g. "Line 8: Chromosome chr22, position 105002, reference allele 'G' does not match the reference sequence, expected 'T'"
                                match_m = re.search(
                                    r"Chromosome\s+([A-Za-z0-9_]+),\s+position\s+(\d+),\s+reference allele\s+'([^']+)'\s+does not match.*expected\s+'([^']+)'",
                                    stripped,
                                )
                                if match_m:
                                    asm_mismatches.append(
                                        {
                                            "line": stripped,
                                            "chrom": match_m.group(1),
                                            "pos": int(match_m.group(2)),
                                            "ref": match_m.group(3),
                                            "expected": match_m.group(4),
                                        }
                                    )
                                else:
                                    asm_other_findings.append(stripped)

                    # The EBI tools log to stderr; an unparsable rate (e.g. "-nan%") stays None
                    pct_m = re.search(r"Percentage of matches:\s+([0-9\.]+)%", asm_log)
                    pct_match = float(pct_m.group(1)) if pct_m else None

                    no_findings = not asm_mismatches and not asm_other_findings
                    if no_findings and (pct_match is None or (pct_match == 100.0 and asm_res.returncode != 0)):
                        checks.append(
                            ScientificCheckResult(
                                validator_id="ebi_assembly_checker",
                                tool_version=tool_version,
                                status="ERROR",
                                check_id="assembly_checker_execution_error",
                                message=(
                                    "Assembly checker produced no usable concordance result "
                                    f"(exit code {asm_res.returncode})."
                                ),
                            )
                        )
                    elif no_findings and pct_match == 100.0:
                        assembly_valid = True
                        checks.append(
                            ScientificCheckResult(
                                validator_id="ebi_assembly_checker",
                                tool_version=tool_version,
                                status="PASS",
                                check_id="reference_allele_concordance",
                                message="All variant records matched the reference FASTA sequence (100% concordance).",
                                details={"concordance_pct": pct_match},
                            )
                        )
                    else:
                        assembly_valid = False
                        for mm in asm_mismatches:
                            checks.append(
                                ScientificCheckResult(
                                    validator_id="ebi_assembly_checker",
                                    tool_version=tool_version,
                                    status="FAIL",
                                    check_id="reference_allele_mismatch",
                                    locus=f"{mm['chrom']}:{mm['pos']}",
                                    message=mm["line"],
                                    details=mm,
                                )
                            )
                        for line in asm_other_findings:
                            checks.append(
                                ScientificCheckResult(
                                    validator_id="ebi_assembly_checker",
                                    tool_version=tool_version,
                                    status="FAIL",
                                    check_id="assembly_report_finding",
                                    message=line,
                                    details={"line": line},
                                )
                            )
                        if no_findings:
                            checks.append(
                                ScientificCheckResult(
                                    validator_id="ebi_assembly_checker",
                                    tool_version=tool_version,
                                    status="FAIL",
                                    check_id="reference_allele_mismatch",
                                    message=f"Reference concordance check failed with {pct_match}% match rate.",
                                    details={"concordance_pct": pct_match},
                                )
                            )

                except Exception as e:
                    checks.append(
                        ScientificCheckResult(
                            validator_id="ebi_assembly_checker",
                            tool_version=tool_version,
                            status="ERROR",
                            check_id="assembly_checker_execution_error",
                            message=f"Assembly checker encountered error: {e!s}",
                        )
                    )

            has_error = any(c.status == "ERROR" for c in checks)
            overall_valid = is_syntax_valid and (assembly_valid is not False) and not has_error
            has_fail = any(c.status == "FAIL" for c in checks)

            if has_error:
                overall_status = "ERROR"
            elif has_fail:
                overall_status = "FAIL"
            else:
                overall_status = "PASS"

            return EbiValidationReport(
                is_valid=overall_valid,
                overall_status=overall_status,
                checks=checks,
                total_errors=sum(1 for c in checks if c.status in ("FAIL", "ERROR")),
                total_warnings=sum(1 for c in checks if c.status == "WARNING"),
                syntax_valid=is_syntax_valid,
                assembly_valid=assembly_valid,
                runtime_ms=(time.perf_counter() - start_time) * 1000,
                raw_validator_stdout=validator_stdout,
                raw_assembly_stdout=assembly_stdout,
                details={
                    "validator_binary": str(self.validator_path),
                    "assembly_binary": str(self.assembly_path),
                },
            )
