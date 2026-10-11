from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FailureHypothesis:
    failure_type: str
    target_locus: str | None
    observed_discrepancy: str
    recommended_policy_action: str
    rationale: str


class FailureTraceReflector:
    """
    Reflective diagnostic engine.
    Analyzes raw validation failure records and synthesizes safe, typed
    mutation hypotheses without touching ground truth or leaking held-out tests.
    """

    @staticmethod
    def reflect_on_discrepancy(finding_record: dict[str, Any]) -> FailureHypothesis:
        status = finding_record.get("status", "")
        code = finding_record.get("code") or ""
        details = str(finding_record.get("details") or "")
        nested_locus = finding_record.get("locus")
        if not isinstance(nested_locus, dict):
            nested_locus = {}
        pos = finding_record.get("pos") or nested_locus.get("pos")
        chrom = finding_record.get("chrom") or nested_locus.get("chrom") or ""
        locus = f"{chrom}:{pos}" if pos else None

        code_lower = str(code).lower()
        details_lower = str(details).lower()

        if ("ref" in code_lower and ("match" in code_lower or "allele" in code_lower)) or ("ref allele" in details_lower and ("match" in details_lower or "does not match" in details_lower)):
            return FailureHypothesis(
                failure_type="REF_ALLELE_MISMATCH",
                target_locus=locus,
                observed_discrepancy=details or "VCF record declared REF allele does not match reference sequence.",
                recommended_policy_action="enforce_strict_ref_checking",
                rationale="Harness previously bypassed reference allele check, letting mismatched variants pass.",
            )
        elif code == "COORDINATE_OUT_OF_BOUNDS" or "boundary" in code_lower or "out of bounds" in details_lower:
            return FailureHypothesis(
                failure_type="COORDINATE_OVERFLOW",
                target_locus=locus,
                observed_discrepancy=details or "Variant position exceeds contig length in FASTA reference.",
                recommended_policy_action="enforce_boundary_guards",
                rationale="Harness requires pre-flight contig length verification against FASTA index.",
            )
        elif "contig" in code_lower or "contig" in details_lower:
            return FailureHypothesis(
                failure_type="CONTIG_NOT_FOUND",
                target_locus=locus,
                observed_discrepancy=details or "VCF contig is missing from declared reference assembly.",
                recommended_policy_action="enforce_contig_compatibility",
                rationale="Validation policy must assert contig presence before reading variant lines.",
            )
        elif code == "PARSE_ERROR" or "malformed" in details_lower:
            return FailureHypothesis(
                failure_type="MALFORMED_VCF",
                target_locus=locus,
                observed_discrepancy=details or "Syntax or header parse failure in genomic variant stream.",
                recommended_policy_action="enforce_strict_header_syntax",
                rationale="Early syntax validation prevents silent parser corruption.",
            )
        else:
            return FailureHypothesis(
                failure_type="UNKNOWN_INTEGRITY_FAILURE",
                target_locus=locus,
                observed_discrepancy=details or f"Unhandled failure status {status}/{code}",
                recommended_policy_action="request_metadata_clarification",
                rationale="Ambiguous or undocumented discrepancy cannot be safely repaired without human review.",
            )
