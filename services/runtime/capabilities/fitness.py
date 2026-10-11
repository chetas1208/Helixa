from __future__ import annotations

from services.runtime.capabilities.macro_schema import CapabilityRecord, CapabilityStatus
from services.runtime.capabilities.registry import CapabilityRegistry


class FitnessTracker:
    """
    Monitors capability reliability and auto-quarantines failing skills.
    """

    def __init__(self, registry: CapabilityRegistry, quarantine_failure_threshold: int = 3):
        self.registry = registry
        self.failure_threshold = quarantine_failure_threshold

    async def record_execution(self, capability_id: str, success: bool) -> CapabilityRecord:
        rec = await self.registry.get_capability(capability_id)
        if not rec:
            raise KeyError(f"Capability '{capability_id}' not found.")

        rec.total_executions += 1
        if not success:
            rec.failed_executions += 1

        rec.fitness_score = (
            (rec.total_executions - rec.failed_executions) / rec.total_executions
            if rec.total_executions > 0
            else 1.0
        )

        if self.registry.collection is not None:
            await self.registry.collection.update_one(
                {"capability_id": capability_id},
                {
                    "$set": {
                        "total_executions": rec.total_executions,
                        "failed_executions": rec.failed_executions,
                        "fitness_score": rec.fitness_score,
                    }
                },
            )

        # Auto-quarantine if consecutive/total failures exceed threshold
        if rec.failed_executions >= self.failure_threshold and rec.status == CapabilityStatus.ACTIVE:
            await self.registry.quarantine_capability(
                capability_id,
                reason=f"Auto-quarantined: failed executions ({rec.failed_executions}) reached threshold ({self.failure_threshold})",
            )
            rec.status = CapabilityStatus.QUARANTINED

        return rec
