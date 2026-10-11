from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pymongo import ReturnDocument

from services.integrations.mongodb import (
    CheckpointModel,
    CheckpointRepository,
    EvaluationRepository,
    EventRepository,
    EvidenceReceiptModel,
    EvidenceRepository,
    FencingTokenConflictError,
    HarnessRepository,
    HarnessStatus,
    HarnessVersionModel,
    MongoDBClient,
    RunEventModel,
    RunModel,
    RunRepository,
    RunState,
    TaskRepository,
)
from services.runtime.evaluation import IndependentEvaluator
from services.runtime.genomics import (
    CheckStatus,
    DeterministicGenomicsValidator,
    ValidationPolicy,
)
from services.runtime.harness import (
    HarnessSpec,
    create_candidate_mutation,
    get_baseline_harness,
)
from services.runtime.providers import DeterministicProposer, Message

logger = logging.getLogger("diamond.runner")

_TERMINAL_STATES = {RunState.PROMOTED, RunState.REJECTED, RunState.COMPLETED}


def _reject_unsafe_filename(name: str) -> None:
    if (
        not isinstance(name, str)
        or not name
        or len(name) > 255
        or "\x00" in name
        or "/" in name
        or "\\" in name
        or ".." in name
    ):
        raise ValueError(f"unsafe fixture filename: {name!r}")


class AgentRunner:
    """
    Durable Agent State Machine executing the Proof-Carrying Harness Evolution cycle.
    Persists events, checkpoints, and receipts to MongoDB after each state change.
    Resumes seamlessly from existing checkpoints and latest sequence IDs without collisions.
    Enforces valid state machine transitions and fencing token isolation.
    """

    def __init__(
        self,
        mongo_client: MongoDBClient,
        fixtures_dir: str | Path = "fixtures",
    ):
        self.mongo = mongo_client
        self.fixtures_dir = Path(fixtures_dir).resolve()
        self.evaluator = IndependentEvaluator(self.fixtures_dir)
        self.proposer = DeterministicProposer()

        # Repositories
        self.events = EventRepository(mongo=self.mongo)
        self.checkpoints = CheckpointRepository(mongo=self.mongo)
        self.runs = RunRepository(mongo=self.mongo)
        self.tasks = TaskRepository(mongo=self.mongo)
        self.harnesses = HarnessRepository(mongo=self.mongo)
        self.evidence = EvidenceRepository(mongo=self.mongo)
        self.evaluations = EvaluationRepository(mongo=self.mongo)

    async def emit_event(
        self,
        run_id: str,
        seq: int | None,
        event_type: str,
        entity_id: str | None = None,
        evidence_digest: str | None = None,
        idempotency_key: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> RunEventModel:
        """
        Emits and persists event. If seq is None or provided, EventRepository
        uses atomic sequence allocation to prevent collisions.
        """
        return await self.events.append_event(
            run_id=run_id,
            event_type=event_type,
            entity_id=entity_id,
            evidence_digest=evidence_digest,
            idempotency_key=idempotency_key,
            payload=payload or {},
        )

    async def save_checkpoint(
        self,
        run_id: str,
        step_index: int,
        state: RunState,
        active_harness_id: str,
        candidate_harness_id: str | None = None,
        evidence_receipt_id: str | None = None,
        fence_token: int = 1,
        payload: dict[str, Any] | None = None,
    ) -> CheckpointModel:
        cp = CheckpointModel(
            checkpoint_id=f"chk-{run_id}-{step_index}",
            run_id=run_id,
            step_index=step_index,
            state=state,
            active_harness_id=active_harness_id,
            candidate_harness_id=candidate_harness_id,
            evidence_receipt_id=evidence_receipt_id,
            fence_token=fence_token,
            timestamp=datetime.now(UTC).isoformat(),
            payload=payload or {},
        )
        await self.checkpoints.save_checkpoint(cp)
        return cp

    async def execute_run(
        self,
        task_id: str,
        run_id: str,
        vcf_filename: str = "ref_mismatch.vcf",
        fasta_filename: str = "ref_synthetic_chr22.fasta",
        fence_token: int | None = None,
    ) -> dict[str, Any]:
        """
        Executes or resumes a durable run through the valid state graph.
        Respects worker fence_token if provided.
        """
        _reject_unsafe_filename(vcf_filename)
        _reject_unsafe_filename(fasta_filename)
        vcf_path = self._resolve_fixture(vcf_filename, "invalid", "valid")
        fasta_path = self._resolve_fixture(fasta_filename, "references")

        f_token = fence_token if fence_token is not None else 1

        existing_run = await self.runs.get_run(run_id)
        if existing_run and fence_token is not None and existing_run.fence_token != fence_token:
            raise FencingTokenConflictError(
                f"Run {run_id} rejected fence_token {fence_token}; active generation is {existing_run.fence_token}."
            )

        latest_cp = await self.checkpoints.get_latest_checkpoint(run_id)
        if latest_cp and latest_cp.state in _TERMINAL_STATES:
            prior = await self.events.get_events(run_id, limit=500)
            if any(event.event_type == "run.completed" for event in prior):
                final_run = await self.runs.get_run(run_id)
                assert final_run is not None
                return final_run.model_dump(mode="json")

        if not existing_run:
            await self.runs.create_run(
                RunModel(
                    run_id=run_id,
                    task_id=task_id,
                    status=RunState.CREATED,
                    active_harness_version="harness-v1",
                    fence_token=f_token,
                    vcf_filename=vcf_filename,
                    fasta_filename=fasta_filename,
                )
            )

        if not await self._claim_execution(run_id):
            busy = await self.runs.get_run(run_id)
            assert busy is not None
            return busy.model_dump(mode="json")

        try:
            return await self._execute_claimed(
                task_id,
                run_id,
                vcf_filename,
                vcf_path,
                fasta_path,
                fence_token,
                f_token,
            )
        finally:
            await self._release_execution(run_id)

    def _resolve_fixture(self, name: str, *folders: str) -> Path:
        root = self.fixtures_dir.resolve()
        for folder in folders:
            candidate = (root / folder / name).resolve()
            if not candidate.is_relative_to(root):
                raise ValueError(f"unsafe fixture filename: {name!r}")
            try:
                exists = candidate.is_file()
            except OSError as exc:
                raise ValueError(f"unsafe fixture filename: {name!r}") from exc
            if exists:
                return candidate
        raise FileNotFoundError(name)

    async def _claim_execution(self, run_id: str) -> bool:
        doc = await self.mongo.db.runs.find_one_and_update(
            {"run_id": run_id, "executing": {"$ne": True}},
            {"$set": {"executing": True}},
            return_document=ReturnDocument.AFTER,
        )
        return doc is not None

    async def _release_execution(self, run_id: str) -> None:
        await self.mongo.db.runs.update_one({"run_id": run_id}, {"$set": {"executing": False}})

    async def _emit(
        self,
        run_id: str,
        event_type: str,
        *,
        entity_id: str | None = None,
        evidence_digest: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> RunEventModel:
        marker = ""
        if payload:
            marker = f":{payload.get('from', '')}:{payload.get('to', '')}"
        return await self.emit_event(
            run_id,
            None,
            event_type,
            entity_id=entity_id,
            evidence_digest=evidence_digest,
            idempotency_key=f"{run_id}:{event_type}:{entity_id or ''}{marker}",
            payload=payload,
        )

    async def _execute_claimed(
        self,
        task_id: str,
        run_id: str,
        vcf_filename: str,
        vcf_path: Path,
        fasta_path: Path,
        fence_token: int | None,
        f_token: int,
    ) -> dict[str, Any]:
        latest_cp = await self.checkpoints.get_latest_checkpoint(run_id)
        step_idx = latest_cp.step_index if latest_cp else 0
        current_state = latest_cp.state if latest_cp else None
        has_oracle_failure = bool(latest_cp and latest_cp.payload.get("has_oracle_failure"))

        # Active & candidate harnesses
        active_harness = get_baseline_harness()
        candidate_harness: HarnessSpec | None = None
        evidence_receipt_id: str | None = None

        if latest_cp and latest_cp.active_harness_id:
            h_model = await self.harnesses.get_version(latest_cp.active_harness_id)
            if h_model:
                active_harness = HarnessSpec(**h_model.model_dump())

        if latest_cp and latest_cp.candidate_harness_id:
            c_model = await self.harnesses.get_version(latest_cp.candidate_harness_id)
            if c_model:
                candidate_harness = HarnessSpec(**c_model.model_dump())

        if latest_cp and latest_cp.evidence_receipt_id:
            evidence_receipt_id = latest_cp.evidence_receipt_id

        run_now = await self.runs.get_run(run_id)
        if run_now and run_now.status in {RunState.PROMOTED, RunState.REJECTED} and current_state not in _TERMINAL_STATES:
            stored = await self.evidence.get_receipt_by_run(run_id)
            if stored is not None:
                evidence_receipt_id = stored.receipt_id
            if run_now.status == RunState.PROMOTED and candidate_harness is not None:
                active_harness = candidate_harness
            decision = "candidate.promoted" if run_now.status == RunState.PROMOTED else "candidate.rejected"
            await self._emit(
                run_id,
                decision,
                entity_id=active_harness.version_id,
                evidence_digest=None if stored is None else stored.receipt_digest,
            )
            current_state = run_now.status

        # 1. State: CREATED
        if current_state is None:
            await self.harnesses.save_version(
                HarnessVersionModel(
                    harness_id=active_harness.harness_id,
                    version_id=active_harness.version_id,
                    status=HarnessStatus.BASELINE,
                    validation_policy=active_harness.validation_policy.model_dump(),
                    context_policy=active_harness.context_policy.model_dump(),
                    execution_policy=active_harness.execution_policy.model_dump(),
                    allowed_tools=active_harness.allowed_tools,
                )
            )
            await self._emit(
                run_id, "run.created", entity_id=run_id, payload={"task_id": task_id, "vcf": vcf_filename}
            )
            await self.save_checkpoint(
                run_id, step_idx, RunState.CREATED, active_harness.version_id, fence_token=f_token
            )
            current_state = RunState.CREATED

        # 2. State: VALIDATING
        if current_state == RunState.CREATED:
            step_idx += 1
            await self.runs.transition_state(run_id, RunState.VALIDATING, fence_token=fence_token)
            await self._emit(
                run_id, "run.state.transition", entity_id=run_id, payload={"from": "CREATED", "to": "VALIDATING"}
            )

            val_policy = ValidationPolicy(
                require_reference_allele_check=active_harness.validation_policy.require_reference_allele_check,
                require_contig_compatibility=active_harness.validation_policy.require_contig_compatibility,
                require_normalization_check=active_harness.validation_policy.require_normalization_check,
                require_assembly_declaration=active_harness.validation_policy.require_assembly_declaration,
            )
            validator = DeterministicGenomicsValidator(policy=val_policy)
            report = validator.validate(vcf_path, fasta_path)

            oracle_validator = DeterministicGenomicsValidator(policy=ValidationPolicy(require_reference_allele_check=True))
            oracle_report = oracle_validator.validate(vcf_path, fasta_path)
            has_oracle_failure = (oracle_report.overall_status == CheckStatus.FAIL)

            await self._emit(
                run_id,
                "run.validation.completed",
                payload={
                    "harness_status": report.overall_status.value,
                    "oracle_status": oracle_report.overall_status.value,
                    "total_records": report.total_records,
                    "findings_count": len(oracle_report.findings),
                    "findings": [item.model_dump(mode="json") for item in oracle_report.findings],
                },
            )
            current_state = RunState.VALIDATING
            await self.save_checkpoint(
                run_id,
                step_idx,
                current_state,
                active_harness.version_id,
                fence_token=f_token,
                payload={"has_oracle_failure": has_oracle_failure},
            )

        # 3. State: DIAGNOSING
        if current_state == RunState.VALIDATING:
            step_idx += 1
            await self.runs.transition_state(run_id, RunState.DIAGNOSING, fence_token=fence_token)
            if has_oracle_failure:
                await self._emit(
                    run_id,
                    "reference.check.failed",
                    payload={"message": "REF allele mismatch detected by scientific oracle"},
                )
            await self._emit(
                run_id, "run.state.transition", payload={"from": "VALIDATING", "to": "DIAGNOSING"}
            )

            diag_response = await self.proposer.generate(
                [
                    Message(
                        role="user",
                        content=f"Validation failed on reference_ref_allele_match. Baseline harness {active_harness.version_id} has require_reference_allele_check={active_harness.validation_policy.require_reference_allele_check}.",
                    )
                ]
            )
            await self._emit(
                run_id, "run.diagnosis.completed", payload={"diagnosis": diag_response.content}
            )
            current_state = RunState.DIAGNOSING
            await self.save_checkpoint(
                run_id, step_idx, current_state, active_harness.version_id, fence_token=f_token
            )

        # 4. State: MUTATING
        if current_state == RunState.DIAGNOSING:
            step_idx += 1
            await self.runs.transition_state(run_id, RunState.MUTATING, fence_token=fence_token)
            await self._emit(
                run_id, "run.state.transition", payload={"from": "DIAGNOSING", "to": "MUTATING"}
            )

            candidate_harness = create_candidate_mutation(active_harness, version_id="harness-v2-candidate")
            await self.harnesses.save_version(
                HarnessVersionModel(
                    harness_id=candidate_harness.harness_id,
                    version_id=candidate_harness.version_id,
                    parent_version_id=active_harness.version_id,
                    status=HarnessStatus.CANDIDATE,
                    validation_policy=candidate_harness.validation_policy.model_dump(),
                    context_policy=candidate_harness.context_policy.model_dump(),
                    execution_policy=candidate_harness.execution_policy.model_dump(),
                    allowed_tools=candidate_harness.allowed_tools,
                    mutation_rationale="Oracle detected REF allele mismatch; promoted require_reference_allele_check.",
                )
            )
            await self._emit(
                run_id,
                "harness.candidate.created",
                entity_id=candidate_harness.version_id,
                payload={
                    "version_id": candidate_harness.version_id,
                    "parent_version_id": active_harness.version_id,
                    "diff": {
                        "require_reference_allele_check": {"from": False, "to": True},
                        "include_reference_metadata": {"from": False, "to": True},
                    },
                },
            )
            current_state = RunState.MUTATING
            await self.save_checkpoint(
                run_id,
                step_idx,
                current_state,
                active_harness.version_id,
                candidate_harness_id=candidate_harness.version_id,
                fence_token=f_token,
            )

        # 5. State: EVALUATING
        if current_state == RunState.MUTATING:
            step_idx += 1
            await self.runs.transition_state(run_id, RunState.EVALUATING, fence_token=fence_token)
            await self._emit(
                run_id, "run.state.transition", payload={"from": "MUTATING", "to": "EVALUATING"}
            )

            if candidate_harness is None:
                candidate_harness = create_candidate_mutation(active_harness, version_id="harness-v2-candidate")

            stored = await self.evidence.get_receipt_by_run(run_id)
            if stored is None:
                eval_result, receipt = self.evaluator.evaluate(active_harness, candidate_harness, run_id=run_id)
                receipt_model = EvidenceReceiptModel(
                    receipt_id=receipt.receipt_id,
                    receipt_digest=receipt.receipt_digest,
                    run_id=run_id,
                    parent_version_id=receipt.parent_version_id,
                    candidate_version_id=receipt.candidate_version_id,
                    score=receipt.score,
                    parent_score=receipt.parent_score,
                    false_positive_rate=receipt.false_positive_rate,
                    promoted=receipt.promoted,
                    fixtures_evaluated=len(receipt.input_hashes),
                    parent_spec_hash=receipt.parent_spec_hash,
                    candidate_spec_hash=receipt.candidate_spec_hash,
                    decision_reason=receipt.decision_reason,
                    sha256=receipt.receipt_digest,
                    timestamp=receipt.created_at,
                    metadata=receipt.metadata,
                )
                await self.evidence.save_receipt(receipt_model)
                stored = receipt_model

            evidence_receipt_id = stored.receipt_id
            promoted = stored.promoted
            await self._emit(
                run_id,
                "evaluation.finished",
                entity_id=candidate_harness.version_id,
                evidence_digest=stored.receipt_digest,
                payload={
                    "candidate_score": stored.score,
                    "parent_score": stored.parent_score,
                    "false_positive_rate": stored.false_positive_rate,
                    "promoted": promoted,
                    "receipt_id": stored.receipt_id,
                },
            )

            if promoted:
                active_harness = candidate_harness
                active_harness.status = HarnessStatus.PROMOTED
                await self.harnesses.save_version(
                    HarnessVersionModel(
                        harness_id=active_harness.harness_id,
                        version_id=active_harness.version_id,
                        parent_version_id=stored.parent_version_id,
                        status=HarnessStatus.PROMOTED,
                        validation_policy=active_harness.validation_policy.model_dump(),
                        context_policy=active_harness.context_policy.model_dump(),
                        execution_policy=active_harness.execution_policy.model_dump(),
                        allowed_tools=active_harness.allowed_tools,
                    )
                )
                await self.runs.transition_state(run_id, RunState.PROMOTED, fence_token=fence_token)
                await self._emit(
                    run_id,
                    "candidate.promoted",
                    entity_id=active_harness.version_id,
                    evidence_digest=stored.receipt_digest,
                )
                current_state = RunState.PROMOTED
            else:
                await self.runs.transition_state(run_id, RunState.REJECTED, fence_token=fence_token)
                await self._emit(
                    run_id, "candidate.rejected", entity_id=candidate_harness.version_id
                )
                current_state = RunState.REJECTED

        # 6. State: Run Completion
        final_state = current_state or RunState.COMPLETED
        step_idx += 1
        await self._emit(
            run_id, "run.completed", entity_id=run_id, payload={"final_state": final_state.value}
        )
        await self.save_checkpoint(
            run_id,
            step_idx,
            final_state,
            active_harness.version_id,
            candidate_harness_id=candidate_harness.version_id if candidate_harness else None,
            evidence_receipt_id=evidence_receipt_id,
            fence_token=f_token,
        )
        await self.runs.update_run(
            run_id,
            {
                "active_harness_version": active_harness.version_id,
                "candidate_harness_version": candidate_harness.version_id if candidate_harness else None,
                "evidence_receipt_id": evidence_receipt_id,
            },
            fence_token=fence_token,
        )

        final_run = await self.runs.get_run(run_id)
        assert final_run is not None
        return final_run.model_dump(mode="json")
