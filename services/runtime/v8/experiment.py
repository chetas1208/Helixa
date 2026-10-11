"""Closed-loop synthetic genomic incident.

The proposer receives only the incident id. Held-out paths stay inside
IndependentEvaluator. GEPA's optimize() is not called. Meta-Harness is not imported.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from pymongo.errors import PyMongoError

from services.integrations.biomni.adapter import BiomniToolAdapter
from services.integrations.contracts import GenomicIncident, ToolInvocationRequest
from services.integrations.elevenlabs.adapter import BriefingRequest, ElevenLabsAdapter
from services.integrations.raindrop.adapter import RaindropAdapter
from services.runtime.evaluation.evaluator import IndependentEvaluator
from services.runtime.evaluation.holdout import (
    HOLDOUT_CASE_IDS,
    assert_proposer_inputs_exclude_holdout,
)
from services.runtime.evaluation.paired_scientific_eval import PairedScientificEvaluator
from services.runtime.evidence.proof_receipt import mint_v8_receipt, verify_v8_receipt
from services.runtime.evolution.gepa_adapter import GepaProposerAdapter, gepa_package_status
from services.runtime.evolution.search_adapter import MetaHarnessSearchAdapter
from services.runtime.genomics.contracts import CheckStatus, ValidationPolicy
from services.runtime.genomics.hasher import compute_sha256
from services.runtime.genomics.validator import DeterministicGenomicsValidator
from services.runtime.harness.baseline import get_baseline_harness
from services.runtime.harness.models import HarnessSpec, PolicyEnvelope
from services.runtime.v8 import checkpoint_store
from services.runtime.v8.checkpoint_store import claim_promotion, load_checkpoint, save_checkpoint

INCIDENT_FIXTURE = "fixtures/invalid/ref_mismatch.vcf"
REFERENCE = "fixtures/references/ref_synthetic_chr22.fasta"


def _write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _reset_active_pointer(output_dir: Path) -> None:
    """A campaign with no completed stage starts from the baseline pointer."""
    try:
        client = checkpoint_store._client()
        client[checkpoint_store._database_name()].v8_active_pointers.delete_many(
            {"namespace": checkpoint_store.namespace_for(output_dir)}
        )
        client.close()
    except PyMongoError:
        pass


def _load_state(path: Path) -> dict[str, Any]:
    file_state = json.loads(path.read_text()) if path.is_file() else None
    mongo_state = load_checkpoint(path.parent)
    if mongo_state and (
        file_state is None
        or len(mongo_state.get("completed", [])) >= len(file_state.get("completed", []))
    ):
        return mongo_state
    if file_state is not None:
        return file_state
    return {"completed": [], "effects": {}, "active_version_id": "harness-v1", "promotion_writes": 0}


def _save_state(path: Path, state: dict[str, Any]) -> str:
    backend = save_checkpoint(path.parent, state)
    state["checkpoint_backend"] = backend
    _write(path, state)
    if backend == "mongodb":
        save_checkpoint(path.parent, state)
    return backend


def run_campaign(
    output_dir: str | Path,
    fixtures_root: str | Path = ".",
    crash_after: str | None = None,
    resume: bool = False,
) -> dict[str, Any]:
    root = Path(fixtures_root)
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    state_path = out / "checkpoint.json"
    if resume:
        state = _load_state(state_path)
    else:
        state = {"completed": [], "effects": {}, "active_version_id": "harness-v1", "promotion_writes": 0}
    if not state["completed"]:
        _reset_active_pointer(out)

    def finish(name: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        if name not in state["completed"]:
            state["completed"].append(name)
            state["effects"][name] = payload
            _save_state(state_path, state)
        if crash_after == name:
            state["interrupted_after"] = name
            _save_state(state_path, state)
            return {
                "status": "INTERRUPTED",
                "interrupted_after": name,
                "completed": list(state["completed"]),
                "checkpoint_backend": state.get("checkpoint_backend", "file"),
            }
        return None

    vcf = root / INCIDENT_FIXTURE
    fasta = root / REFERENCE
    parent = get_baseline_harness()

    if "artifacts_hashed" not in state["completed"]:
        manifest = {
            "incident_fixture": INCIDENT_FIXTURE,
            "incident_sha256": compute_sha256(vcf),
            "reference_sha256": compute_sha256(fasta),
            "holdout_case_ids": sorted(HOLDOUT_CASE_IDS),
            "holdout_sha256": {
                "fixtures/heldout/unseen_mismatch.vcf": compute_sha256(root / "fixtures/heldout/unseen_mismatch.vcf"),
            },
        }
        _write(out / "experiment_manifest.json", manifest)
        interrupted = finish("artifacts_hashed", manifest)
        if interrupted:
            return interrupted
    else:
        manifest = state["effects"]["artifacts_hashed"]

    if "baseline_executed" not in state["completed"]:
        baseline_validator = DeterministicGenomicsValidator(
            policy=ValidationPolicy(
                require_reference_allele_check=False,
                require_contig_compatibility=True,
                require_normalization_check=True,
                require_assembly_declaration=True,
            )
        )
        baseline_report = baseline_validator.validate(vcf, fasta)
        baseline = {
            "harness_version_id": parent.version_id,
            "require_reference_allele_check": False,
            "overall_status": baseline_report.overall_status.value,
            "incident_detected": baseline_report.overall_status == CheckStatus.FAIL,
            "record_count": baseline_report.total_records,
        }
        _write(out / "baseline_results.json", baseline)
        interrupted = finish("baseline_executed", baseline)
        if interrupted:
            return interrupted
    else:
        baseline = state["effects"]["baseline_executed"]

    if "independent_validation" not in state["completed"]:
        paired = PairedScientificEvaluator().adjudicate(vcf, fasta, run_id="v8-synthetic-incident")
        paired_dump = paired.model_dump(mode="json")
        _write(out / "independent_validation.json", paired_dump)
        interrupted = finish("independent_validation", paired_dump)
        if interrupted:
            return interrupted
    else:
        paired_dump = state["effects"]["independent_validation"]

    if "diagnosis" not in state["completed"]:
        diagnosis = {
            "root_cause": "harness_policy_omits_reference_allele_check",
            "scope": "validation_policy.require_reference_allele_check",
            "input_rewritten": False,
            "input_sha256_unchanged": compute_sha256(vcf) == manifest["incident_sha256"],
            "fixable_by_harness_policy": True,
            "independent_adjudication": paired_dump["verdict"],
            "build_identity_proven": False,
        }
        _write(out / "diagnosis.json", diagnosis)
        interrupted = finish("diagnosis", diagnosis)
        if interrupted:
            return interrupted

    incident = GenomicIncident(
        incident_id="synthetic-ref-mismatch",
        run_id="v8-synthetic-incident",
        dataset_sha256=manifest["incident_sha256"],
        reference_sha256=manifest["reference_sha256"],
        failing_check="reference_allele_mismatch",
        error_signature="REF allele does not match the supplied FASTA",
        disagreement_detected=paired_dump["verdict"] == "DISAGREE",
    )
    assert_proposer_inputs_exclude_holdout(["incident_target_ref_mismatch"], [incident.incident_id])

    if "candidates_proposed" not in state["completed"]:
        search = MetaHarnessSearchAdapter()
        proposals = search.generate_candidates(parent, incident, max_candidates=3)
        reflective = GepaProposerAdapter().propose_reflective_candidate(parent, incident)
        envelope = PolicyEnvelope()
        unsafe = parent.model_copy(deep=True)
        unsafe.version_id = f"{parent.version_id}-unsafe-weaken"
        unsafe.allowed_tools = [*parent.allowed_tools, "execute_shell"]
        unsafe.validation_policy.require_contig_compatibility = False
        unsafe_ok, unsafe_reason = envelope.validate_candidate(unsafe)
        gated = []
        for spec, patch in proposals:
            ok, reason = envelope.validate_candidate(spec)
            gated.append(
                {
                    "candidate_id": spec.version_id,
                    "provenance": patch.optimizer_source,
                    "spec": spec.model_dump(mode="json"),
                    "spec_hash": patch.canonical_hash,
                    "diff": patch.policy_diff,
                    "accepted_for_evaluation": ok,
                    "reason": reason,
                    "require_reference_allele_check": spec.validation_policy.require_reference_allele_check,
                }
            )
        if reflective is not None:
            spec, patch = reflective
            ok, reason = envelope.validate_candidate(spec)
            gated.append(
                {
                    "candidate_id": spec.version_id,
                    "provenance": patch.optimizer_source,
                    "spec": spec.model_dump(mode="json"),
                    "spec_hash": patch.canonical_hash,
                    "diff": patch.policy_diff,
                    "accepted_for_evaluation": ok,
                    "reason": reason,
                    "require_reference_allele_check": spec.validation_policy.require_reference_allele_check,
                }
            )
        gated.append(
            {
                "candidate_id": unsafe.version_id,
                "provenance": "DETERMINISTIC",
                "spec": unsafe.model_dump(mode="json"),
                "spec_hash": unsafe.compute_spec_hash(),
                "diff": {"allowed_tools": {"after": unsafe.allowed_tools}},
                "accepted_for_evaluation": unsafe_ok,
                "reason": unsafe_reason,
                "intentionally_unsafe": True,
                "require_reference_allele_check": False,
            }
        )
        _write(out / "harness_diff.json", {"candidates": gated, "meta_harness_imported": False, "gepa_optimize_called": False})
        interrupted = finish("candidates_proposed", {"candidates": gated})
        if interrupted:
            return interrupted
    else:
        gated = state["effects"]["candidates_proposed"]["candidates"]

    accepted = [item for item in gated if item["accepted_for_evaluation"] and item.get("require_reference_allele_check")]
    rejected = [item for item in gated if not item["accepted_for_evaluation"]]

    if "evaluated" not in state["completed"]:
        evaluator = IndependentEvaluator(fixtures_dir=root / "fixtures")
        evaluations = []
        for item in accepted:
            spec = HarnessSpec.model_validate(item["spec"])
            result, _receipt = evaluator.evaluate(parent, spec, run_id="v8-synthetic-incident")
            evaluations.append(
                {
                    "candidate_id": spec.version_id,
                    "promoted": result.promoted,
                    "score": f"{result.score_numerator}/{result.score_denominator}",
                    "parent_score": f"{result.parent_score_numerator}/{result.parent_score_denominator}",
                    "false_positive_rate": result.false_positive_rate,
                    "decision_reason": result.decision_reason,
                    "test_results": [row.model_dump() for row in result.test_results],
                }
            )
        chosen = next((row for row in evaluations if row["promoted"]), None)
        payload = {
            "evaluations": evaluations,
            "chosen_candidate_id": None if chosen is None else chosen["candidate_id"],
            "eval_runs": 1,
        }
        _write(out / "candidate_results.json", payload)
        interrupted = finish("evaluated", payload)
        if interrupted:
            return interrupted
    else:
        payload = state["effects"]["evaluated"]

    chosen_id = payload.get("chosen_candidate_id")
    chosen = next((row for row in payload["evaluations"] if row["candidate_id"] == chosen_id), None)

    if "promoted" not in state["completed"]:
        promoted = False
        backend = state.get("checkpoint_backend", "file")
        if chosen and chosen["promoted"] and state.get("active_version_id") == parent.version_id:
            claimed = True if backend != "mongodb" else claim_promotion(out, parent.version_id, chosen_id)
            if claimed:
                state["active_version_id"] = chosen_id
                state["promotion_writes"] = int(state.get("promotion_writes", 0)) + 1
                promoted = True
                _save_state(state_path, state)
        elif chosen and chosen["promoted"] and state.get("active_version_id") == chosen_id:
            promoted = True
        holdout_rows = [] if not chosen else [row for row in chosen["test_results"] if row["category"] == "heldout_transfer"]
        negative_rows = [] if not chosen else [row for row in chosen["test_results"] if row["category"] == "negative_control"]
        _write(out / "holdout_results.json", {"cases": holdout_rows, "isolated_from_proposer": True})
        ablation = _ablation(root, parent, incident)
        _write(out / "ablation.json", ablation)
        biomni = BiomniToolAdapter()
        biomni_result = biomni.invoke(
            ToolInvocationRequest(tool_id="biomni_vcf_stats_inspector", artifact_id_or_path=str(vcf))
        )
        gepa_status, gepa_detail = gepa_package_status()
        raindrop = RaindropAdapter(enabled=False, write_key="")
        eleven = ElevenLabsAdapter(enabled=False, api_key="")
        decision = "PROMOTED" if promoted else "REJECTED"
        candidate_hash = next((item["spec_hash"] for item in gated if item["candidate_id"] == chosen_id), parent.compute_spec_hash())
        receipt = mint_v8_receipt(
            run_id="v8-synthetic-incident",
            incident_id=incident.incident_id,
            candidate_hash=candidate_hash,
            dual_validator_agreement=paired_dump["verdict"],
            safety_gates={
                "unsafe_candidate_rejected": any(item.get("intentionally_unsafe") and not item["accepted_for_evaluation"] for item in gated),
                "holdout_isolated": True,
                "input_not_rewritten": compute_sha256(vcf) == manifest["incident_sha256"],
            },
            decision=decision,
            metadata={
                "parent_version_id": parent.version_id,
                "candidate_version_id": chosen_id,
                "optimizer_provenance": "DETERMINISTIC",
                "score": None if not chosen else chosen["score"],
                "parent_score": None if not chosen else chosen["parent_score"],
                "false_positive_count": sum(1 for row in negative_rows if not row["candidate_passed"]),
                "negative_control_count": len(negative_rows),
                "holdout_case_ids": sorted(HOLDOUT_CASE_IDS),
                "reference_artifact_sha256": manifest["reference_sha256"],
                "raindrop_status": raindrop.status,
                "elevenlabs_status": eleven.status,
                "decision_reason": None if not chosen else chosen["decision_reason"],
                "gepa_status": gepa_status,
                "biomni_status": biomni_result.status,
                "build_identity_proven": False,
            },
        )
        receipt_dict = receipt.model_dump(mode="json")
        receipt_dict["fingerprint_verified"] = verify_v8_receipt(receipt)
        _write(out / "evidence_receipt.json", receipt_dict)
        nodes = [
            {
                "id": parent.version_id,
                "version_id": parent.version_id,
                "status": "BASELINE",
                "parent_id": None,
                "optimizer_provenance": "BASELINE",
                "require_reference_allele_check": False,
                "include_reference_metadata": parent.context_policy.include_reference_metadata,
            }
        ]
        for item in gated:
            nodes.append(
                {
                    "id": item["candidate_id"],
                    "version_id": item["candidate_id"],
                    "status": "PROMOTED" if item["candidate_id"] == state["active_version_id"] else (
                        "REJECTED" if not item["accepted_for_evaluation"] else "CANDIDATE"
                    ),
                    "parent_id": parent.version_id,
                    "optimizer_provenance": item["provenance"],
                    "require_reference_allele_check": item.get("require_reference_allele_check", False),
                    "include_reference_metadata": item["spec"]["context_policy"]["include_reference_metadata"],
                    "gate_reason": item["reason"],
                }
            )
        _write(
            out / "lineage.json",
            {
                "active_version_id": state["active_version_id"],
                "promotion_writes": state["promotion_writes"],
                "rejected_candidate_ids": [item["candidate_id"] for item in rejected],
                "optimizer_provenance": "DETERMINISTIC",
                "meta_harness_imported": False,
                "nodes": nodes,
            },
        )
        briefing = eleven.compose_briefing_script(
            BriefingRequest(
                receipt_id=receipt.receipt_id,
                run_id=receipt.run_id,
                candidate_version_id=chosen_id or "none",
                score=receipt.metadata.get("score") or "0/0",
                promoted=promoted,
                decision_reason=receipt.metadata.get("decision_reason") or decision,
            )
        )
        _write(out / "briefing.json", {"status": eleven.status, "script": briefing, "automatic": False})
        _write(
            out / "runtime_metrics.json",
            {
                "baseline_incident_detected": int(bool(baseline["incident_detected"])),
                "baseline_cases": 1,
                "independent_adjudication": paired_dump["verdict"],
                "candidates_proposed": len(gated),
                "candidates_rejected_before_evaluation": len(rejected),
                "candidates_evaluated": len(payload["evaluations"]),
                "promoted": promoted,
                "promotion_writes": state["promotion_writes"],
                "gepa_optimize_calls": 0,
                "gepa_status": gepa_status,
                "gepa_detail": gepa_detail,
                "model_calls": 0,
                "biomni_tool_status": biomni_result.status,
                "raindrop_status": raindrop.status,
                "elevenlabs_status": eleven.status,
                "ablation_promoted": ablation["optimizer_disabled_tool_discovery"]["promoted"],
                "control_detected": int(bool(baseline["incident_detected"])),
                "meta_harness_imported": False,
                "checkpoint_backend": state.get("checkpoint_backend", "file"),
            },
        )
        finish("promoted", {"promoted": promoted, "fingerprint": receipt.receipt_digest})

    receipt_dict = json.loads((out / "evidence_receipt.json").read_text())
    return {
        "status": "COMPLETED",
        "promoted": receipt_dict["decision"] == "PROMOTED",
        "fingerprint": receipt_dict["receipt_digest"],
        "fingerprint_matches": receipt_dict.get("fingerprint_verified", False),
        "active_version_id": state["active_version_id"],
        "promotion_writes": state["promotion_writes"],
        "checkpoint_backend": state.get("checkpoint_backend", "file"),
        "completed": list(state["completed"]),
        "output_dir": str(out),
    }


def _ablation(root: Path, parent: HarnessSpec, incident: GenomicIncident) -> dict[str, Any]:
    from services.runtime.harness.models import ContextPolicy

    ablated = parent.model_copy(deep=True)
    ablated.context_policy = ContextPolicy(
        include_reference_metadata=False,
        include_prior_failures=False,
        max_context_items=parent.context_policy.max_context_items,
    )
    reflective = GepaProposerAdapter().propose_reflective_candidate(ablated, incident)
    if reflective is None:
        return {"optimizer_disabled_tool_discovery": {"promoted": False, "reason": "no candidate"}}
    spec, _patch = reflective
    result, _receipt = IndependentEvaluator(fixtures_dir=root / "fixtures").evaluate(
        parent, spec, run_id="v8-ablation"
    )
    return {
        "optimizer_disabled_tool_discovery": {
            "promoted": result.promoted,
            "score": f"{result.score_numerator}/{result.score_denominator}",
            "note": "Single exploratory ablation. Tool discovery was not on the causal path of the REF-policy repair.",
        }
    }
