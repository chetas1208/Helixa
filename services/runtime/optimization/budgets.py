from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass(frozen=True)
class OptimizationBudget:
    max_proposals: int = 3
    max_evaluator_calls: int = 6
    max_retries: int = 2
    timeout_seconds: float = 30.0
    max_tokens: int = 4096


@dataclass
class BudgetTracker:
    budget: OptimizationBudget
    proposals_used: int = 0
    evaluator_calls_used: int = 0
    start_time: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())
    stopped_reason: str | None = None

    def can_propose(self) -> bool:
        if self.proposals_used >= self.budget.max_proposals:
            self.stopped_reason = f"Exceeded max_proposals ({self.budget.max_proposals})"
            return False
        return True

    def record_proposal(self) -> None:
        self.proposals_used += 1

    def can_evaluate(self) -> bool:
        if self.evaluator_calls_used >= self.budget.max_evaluator_calls:
            self.stopped_reason = f"Exceeded max_evaluator_calls ({self.budget.max_evaluator_calls})"
            return False
        return True

    def record_evaluator_call(self) -> None:
        self.evaluator_calls_used += 1
