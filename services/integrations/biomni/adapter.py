from __future__ import annotations

import gzip
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any, Protocol

from services.integrations.contracts import (
    ScientificToolManifest,
    ToolInvocationRequest,
    ToolInvocationResult,
)

from .capability_manifest import BIOMNI_CAPABILITY_MANIFESTS, get_biomni_manifest


class ScientificToolAdapter(Protocol):
    def list_manifests(self) -> list[ScientificToolManifest]: ...
    def get_manifest(self, tool_id: str) -> ScientificToolManifest | None: ...
    def invoke(self, request: ToolInvocationRequest) -> ToolInvocationResult: ...


class BiomniToolAdapter:
    """
    Sandboxed scientific adapter wrapping Biomni biomedical tool capabilities.
    Strictly confines all invocations to bounded read-only inspection operations.
    Enforces fail-closed rejection on any execution payload containing dangerous tokens,
    subprocesses, or host modification primitives.
    """

    FORBIDDEN_PATTERNS = [
        re.compile(r"\b(exec|eval|__import__|importlib)\b", re.IGNORECASE),
        re.compile(r"\b(os\.system|subprocess|pty|popen|socket|urllib|requests)\b", re.IGNORECASE),
        re.compile(r"(\||;|`|\$\(|\$\{|<|>)"),
    ]

    TRANSITIONS = {("A", "G"), ("G", "A"), ("C", "T"), ("T", "C")}
    TRANSVERSIONS = {
        ("A", "C"), ("C", "A"), ("A", "T"), ("T", "A"),
        ("G", "C"), ("C", "G"), ("G", "T"), ("T", "G"),
    }

    def __init__(self, allowed_workspaces: list[Path] | None = None):
        self.allowed_workspaces = allowed_workspaces or [Path(".").resolve()]
        self._enforce_workspaces = bool(allowed_workspaces)

    def health(self) -> tuple[Any, str]:
        from services.runtime.v8.contracts import IntegrationStatus
        return (
            IntegrationStatus.CONNECTED,
            "Biomni tool adapter operational in strict sandboxed read-only mode",
        )

    def list_manifests(self) -> list[ScientificToolManifest]:

        return list(BIOMNI_CAPABILITY_MANIFESTS.values())

    def get_manifest(self, tool_id: str) -> ScientificToolManifest | None:
        return get_biomni_manifest(tool_id)

    def invoke(self, request: ToolInvocationRequest) -> ToolInvocationResult:
        start_time = time.perf_counter()
        manifest = self.get_manifest(request.tool_id)

        if not manifest:
            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="ERROR",
                exit_code=1,
                stderr=f"Unknown tool_id: {request.tool_id}. Not registered in Biomni capabilities.",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )

        # 1. Security Containment Audit
        violation = self._inspect_security_violations(request)
        if violation:
            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="ERROR",
                exit_code=126,
                stderr=f"SECURITY_VIOLATION: {violation}",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )

        raw_path = request.artifact_id_or_path
        if "\x00" in raw_path or ".." in Path(raw_path).parts:
            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="ERROR",
                exit_code=126,
                stderr="SECURITY_VIOLATION: rejected path traversal",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )

        # 2. File Path Sandbox Enforcement
        if Path(raw_path).is_symlink():
            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="ERROR",
                exit_code=126,
                stderr="SECURITY_VIOLATION: rejected symlink input",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )
        target_path = Path(raw_path).resolve()
        if self._enforce_workspaces and not any(
            target_path.is_relative_to(workspace.resolve()) for workspace in self.allowed_workspaces
        ):
            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="ERROR",
                exit_code=126,
                stderr="SECURITY_VIOLATION: path is outside the allowed workspaces",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )
        if not target_path.exists():
            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="ERROR",
                exit_code=2,
                stderr=f"Target artifact path does not exist: {target_path}",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )
        if not target_path.is_file():
            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="ERROR",
                exit_code=2,
                stderr=f"Target artifact path is not a regular file: {target_path}",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )

        # 3. Deterministic Tool Execution
        try:
            if request.tool_id == "biomni_vcf_stats_inspector":
                findings = self._exec_vcf_stats(target_path)
            elif request.tool_id == "biomni_reference_coordinate_liftover":
                findings = self._exec_liftover_check(target_path, request.arguments)
            elif request.tool_id == "biomni_variant_consequence_lookup":
                findings = self._exec_consequence_lookup(target_path, request.arguments)
            elif request.tool_id == "biomni_genomic_region_overlap":
                findings = self._exec_region_overlap(target_path, request.arguments)
            else:
                findings = [{"message": f"Execution completed for {request.tool_id}"}]

            # Compute output hashes
            serialized = json.dumps(findings, sort_keys=True)
            output_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()

            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="SUCCESS",
                findings=findings,
                exit_code=0,
                stdout=f"Successfully executed sandboxed {request.tool_id}.",
                stderr="",
                output_artifact_hashes=[output_hash],
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )
        except Exception as e:
            return ToolInvocationResult(
                tool_id=request.tool_id,
                status="ERROR",
                exit_code=1,
                stderr=f"Tool execution failure: {e!s}",
                runtime_ms=(time.perf_counter() - start_time) * 1000,
            )

    def _inspect_security_violations(self, request: ToolInvocationRequest) -> str | None:
        # Check tool_id and path strings
        for text in [request.tool_id, request.artifact_id_or_path, request.reference_id_or_path or ""]:
            for pattern in self.FORBIDDEN_PATTERNS:
                if pattern.search(text):
                    return f"Forbidden pattern detected in invocation target: {text}"

        # Deep inspect arguments dictionary
        def _check_val(val: Any) -> str | None:
            if isinstance(val, str):
                for pattern in self.FORBIDDEN_PATTERNS:
                    if pattern.search(val):
                        return f"Forbidden instruction or shell token in parameter: '{val}'"
            elif isinstance(val, dict):
                for k, v in val.items():
                    k_res = _check_val(k)
                    if k_res:
                        return k_res
                    v_res = _check_val(v)
                    if v_res:
                        return v_res
            elif isinstance(val, (list, tuple, set, frozenset)):
                for item in val:
                    item_res = _check_val(item)
                    if item_res:
                        return item_res
            return None

        return _check_val(request.arguments)

    def _exec_vcf_stats(self, vcf_path: Path) -> list[dict[str, Any]]:
        is_gz = vcf_path.suffix.endswith(".gz")
        opener = gzip.open if is_gz else open

        total_records = 0
        untrusted_header_lines = 0
        snv_count = 0
        indel_count = 0
        multiallelic_count = 0
        transitions = 0
        transversions = 0

        with opener(vcf_path, "rt", errors="replace") as f:
            for line in f:
                if line.startswith("#"):
                    lowered = line.lower()
                    if "ignore all prior" in lowered or "ignore previous" in lowered or "system prompt" in lowered:
                        untrusted_header_lines += 1
                    continue
                parts = line.strip().split("\t")
                if len(parts) < 5:
                    continue
                total_records += 1
                ref = parts[3].upper()
                alts = [a.upper() for a in parts[4].split(",")]

                if len(alts) > 1:
                    multiallelic_count += 1

                for alt in alts:
                    if alt == ".":
                        continue
                    if len(ref) == 1 and len(alt) == 1:
                        snv_count += 1
                        pair = (ref, alt)
                        if pair in self.TRANSITIONS:
                            transitions += 1
                        elif pair in self.TRANSVERSIONS:
                            transversions += 1
                    else:
                        indel_count += 1

        titv_ratio = (transitions / transversions) if transversions > 0 else (float(transitions) if transitions > 0 else 0.0)

        return [
            {
                "inspection_type": "vcf_statistics",
                "total_records": total_records,
                "snv_count": snv_count,
                "indel_count": indel_count,
                "multiallelic_count": multiallelic_count,
                "transitions": transitions,
                "transversions": transversions,
                "titv_ratio": round(titv_ratio, 4),
                "untrusted_header_lines": untrusted_header_lines,
                "instruction_text_executed": False,
            }
        ]

    def _exec_liftover_check(self, vcf_path: Path, args: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            {
                "inspection_type": "liftover_feasibility",
                "source_assembly": args.get("source_assembly"),
                "target_assembly": args.get("target_assembly"),
                "chain_available": False,
                "status": "INCONCLUSIVE",
                "message": "No liftover chain was supplied. DIAMOND does not infer a genome build or rewrite coordinates.",
            }
        ]

    def _exec_consequence_lookup(self, vcf_path: Path, args: dict[str, Any]) -> list[dict[str, Any]]:
        raise PermissionError(
            "Consequence and pathogenicity annotation is disabled. This tool does not assign clinical impact."
        )

    def _exec_region_overlap(self, vcf_path: Path, args: dict[str, Any]) -> list[dict[str, Any]]:
        regions = args.get("regions") or []
        parsed = [item for item in (_parse_region(region) for region in regions) if item is not None]
        overlap = _count_overlapping_records(vcf_path, parsed)
        return [
            {
                "inspection_type": "region_overlap",
                "target_regions_checked": len(parsed),
                "overlapping_variants": overlap,
                "status": "COUNTED" if parsed else "INCONCLUSIVE",
            }
        ]


def _parse_region(text: str) -> tuple[str, int, int] | None:
    if not isinstance(text, str) or ":" not in text or "-" not in text:
        return None
    chrom, bounds = text.split(":", 1)
    start_s, end_s = bounds.split("-", 1)
    try:
        return chrom, int(start_s), int(end_s)
    except ValueError:
        return None


def _count_overlapping_records(vcf_path: Path, regions: list[tuple[str, int, int]]) -> int:
    if not regions:
        return 0
    count = 0
    opener = gzip.open if str(vcf_path).endswith(".gz") else open
    with opener(vcf_path, "rt", errors="replace") as handle:
        for line in handle:
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            try:
                pos = int(parts[1])
            except ValueError:
                continue
            if any(parts[0] == chrom and start <= pos <= end for chrom, start, end in regions):
                count += 1
    return count

