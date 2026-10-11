from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import BaseModel, Field


class TestCaseResult(BaseModel):
    __test__ = False
    test_id: str
    description: str
    category: str  # "incident_target" | "negative_control" | "heldout_transfer" | "envelope_check"
    parent_passed: bool
    candidate_passed: bool
    details: str

class EvaluationResult(BaseModel):
    candidate_version_id: str
    parent_version_id: str
    score_numerator: int
    score_denominator: int
    parent_score_numerator: int
    parent_score_denominator: int
    false_positive_rate: float
    envelope_compliance: bool
    promoted: bool
    decision_reason: str
    test_results: list[TestCaseResult] = Field(default_factory=list)
    runtime_ms: float = 0.0

    @property
    def candidate_score_str(self) -> str:
        return f"{self.score_numerator}/{self.score_denominator}"

    @property
    def parent_score_str(self) -> str:
        return f"{self.parent_score_numerator}/{self.parent_score_denominator}"

class EvidenceReceipt(BaseModel):
    receipt_id: str
    receipt_digest: str
    run_id: str
    parent_version_id: str
    candidate_version_id: str
    parent_spec_hash: str
    candidate_spec_hash: str
    evaluator_hash: str
    input_hashes: list[str] = Field(default_factory=list)
    score: str  # e.g. "6/6"
    parent_score: str # e.g. "4/6"
    false_positive_rate: float
    promoted: bool
    decision_reason: str
    created_at: str
    metadata: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def create(
        cls,
        receipt_id: str,
        run_id: str,
        eval_result: EvaluationResult,
        parent_hash: str,
        candidate_hash: str,
        evaluator_hash: str,
        input_hashes: list[str],
        timestamp: str,
    ) -> EvidenceReceipt:
        raw_payload = json.dumps(
            {
                "receipt_id": receipt_id,
                "run_id": run_id,
                "parent_version_id": eval_result.parent_version_id,
                "candidate_version_id": eval_result.candidate_version_id,
                "parent_spec_hash": parent_hash,
                "candidate_spec_hash": candidate_hash,
                "evaluator_hash": evaluator_hash,
                "score": eval_result.candidate_score_str,
                "parent_score": eval_result.parent_score_str,
                "promoted": eval_result.promoted,
                "decision_reason": eval_result.decision_reason,
                "timestamp": timestamp,
            },
            sort_keys=True,
        )
        digest = hashlib.sha256(raw_payload.encode("utf-8")).hexdigest()
        return cls(
            receipt_id=receipt_id,
            receipt_digest=digest,
            run_id=run_id,
            parent_version_id=eval_result.parent_version_id,
            candidate_version_id=eval_result.candidate_version_id,
            parent_spec_hash=parent_hash,
            candidate_spec_hash=candidate_hash,
            evaluator_hash=evaluator_hash,
            input_hashes=input_hashes,
            score=eval_result.candidate_score_str,
            parent_score=eval_result.parent_score_str,
            false_positive_rate=eval_result.false_positive_rate,
            promoted=eval_result.promoted,
            decision_reason=eval_result.decision_reason,
            created_at=timestamp,
        )
