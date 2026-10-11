from __future__ import annotations

from .models import (
    ContextPolicy,
    ExecutionPolicy,
    HarnessSpec,
    HarnessStatus,
    ValidationPolicySpec,
)


def get_baseline_harness() -> HarnessSpec:
    """
    Returns the intentionally deficient synthetic research baseline harness (v1).
    Validation policy omits reference_allele_check, simulating the real-world
    workflow gap where researchers miss REF mismatches.
    """
    return HarnessSpec(
        schema_version=1,
        harness_id="diamond-genome",
        version_id="harness-v1",
        parent_version_id=None,
        status=HarnessStatus.BASELINE,
        context_policy=ContextPolicy(
            include_reference_metadata=False,
            include_prior_failures=True,
            max_context_items=12,
        ),
        validation_policy=ValidationPolicySpec(
            require_reference_allele_check=False,  # INTENTIONALLY DEFICIENT BASELINE
            require_contig_compatibility=True,
            require_normalization_check=True,
            require_assembly_declaration=True,
        ),
        execution_policy=ExecutionPolicy(
            checkpoint_every_steps=3,
            max_attempts=2,
        ),
        allowed_tools=[
            "inspect_vcf",
            "inspect_reference",
            "run_validation",
        ],
        metadata={
            "description": "Baseline research agent with disabled reference allele verification",
            "author": "synthetic-baseline",
        },
    )

def create_candidate_mutation(
    parent: HarnessSpec,
    version_id: str = "harness-v2-candidate",
    enable_ref_check: bool = True,
    include_ref_meta: bool = True,
    reason: str = "Diagnosed missing reference verification policy after REF mismatch finding",
) -> HarnessSpec:
    """
    Proposes a bounded mutation addressing the diagnosed validation gap.
    """
    val_policy = parent.validation_policy.model_copy()
    if enable_ref_check:
        val_policy.require_reference_allele_check = True

    ctx_policy = parent.context_policy.model_copy()
    if include_ref_meta:
        ctx_policy.include_reference_metadata = True

    # Expand tools safely within envelope if needed
    tools = list(parent.allowed_tools)
    for t in ["inspect_manifest", "request_evaluation", "inspect_receipt"]:
        if t not in tools:
            tools.append(t)

    return HarnessSpec(
        schema_version=parent.schema_version,
        harness_id=parent.harness_id,
        version_id=version_id,
        parent_version_id=parent.version_id,
        status=HarnessStatus.CANDIDATE,
        context_policy=ctx_policy,
        validation_policy=val_policy,
        execution_policy=parent.execution_policy.model_copy(),
        allowed_tools=tools,
        metadata={
            "mutation_reason": reason,
            "parent_spec_hash": parent.compute_spec_hash(),
        },
    )
