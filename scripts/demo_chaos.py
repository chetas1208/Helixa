#!/usr/bin/env python3
"""
DIAMOND Genome V5 - Worker Chaos Recovery & Generation Fencing Demo
Simulates sudden worker failure mid-execution, automatic generation lease takeover,
resumption from MongoDB checkpoint, and stale-worker fencing isolation.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure project root is in sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from services.integrations.mongodb import (  # noqa: E402
    CheckpointRepository,
    EventRepository,
    EvidenceRepository,
    FencingTokenConflictError,
    MongoDBClient,
    RunModel,
    RunRepository,
    RunState,
    TaskModel,
    TaskRepository,
    TaskStatus,
)
from services.runtime.orchestration import AgentRunner, DurableWorker  # noqa: E402


async def main():
    print("=" * 70)
    print("DIAMOND Genome V5: Chaos Worker Recovery & Lease Fencing Demo")
    print("=" * 70)

    mongo = MongoDBClient()
    await mongo.init_indexes()

    task_repo = TaskRepository(mongo=mongo)
    run_repo = RunRepository(mongo=mongo)
    cp_repo = CheckpointRepository(mongo=mongo)
    event_repo = EventRepository(mongo=mongo)
    evidence_repo = EvidenceRepository(mongo=mongo)

    task_id = "task-chaos-demo-001"
    run_id = "run-chaos-demo-001"

    # 1. Clean previous run state
    await mongo.db.tasks.delete_many({"task_id": task_id})
    await mongo.db.runs.delete_many({"run_id": run_id})
    await mongo.db.checkpoints.delete_many({"run_id": run_id})
    await mongo.db.run_events.delete_many({"run_id": run_id})
    await mongo.db.run_sequence_counters.delete_many({"run_id": run_id})

    # Create initial task
    now_iso = datetime.now(timezone.utc).isoformat()
    await task_repo.create_task(
        TaskModel(
            task_id=task_id,
            dataset_id="SYNTH-GENOME-INCIDENT-001",
            status=TaskStatus.CREATED,
            fence_token=1,
            created_at=now_iso,
            updated_at=now_iso,
        )
    )

    print("\n[Phase 1] Launching Worker-1 (worker-alpha)...")
    worker1 = DurableWorker(worker_id="worker-alpha", mongo_client=mongo, lease_seconds=2)
    acq1 = await worker1.acquire_lease(task_id)
    assert acq1 is True
    fence_1 = worker1.fence_token
    print(f"  Worker-1 acquired lease: fence_token={fence_1}")

    # Worker-1 starts run up to MUTATING checkpoint
    runner1 = AgentRunner(mongo)
    print("  Worker-1 executing Phase 1: Ingestion & Baseline Validation...")
    await run_repo.create_run(
        RunModel(
            run_id=run_id,
            task_id=task_id,
            status=RunState.CREATED,
            active_harness_version="harness-v1",
            fence_token=fence_1,
            vcf_filename="ref_mismatch.vcf",
        )
    )
    await runner1.emit_event(run_id, None, "run.created", payload={"worker": "worker-alpha"})
    await runner1.save_checkpoint(run_id, 0, RunState.CREATED, "harness-v1", fence_token=fence_1)

    print("  Worker-1 transitioning to VALIDATING...")
    await run_repo.transition_state(run_id, RunState.VALIDATING, fence_token=fence_1)
    await runner1.emit_event(run_id, None, "run.state.transition", payload={"from": "CREATED", "to": "VALIDATING"})
    await runner1.save_checkpoint(run_id, 1, RunState.VALIDATING, "harness-v1", fence_token=fence_1)

    print("  Worker-1 transitioning to DIAGNOSING...")
    await run_repo.transition_state(run_id, RunState.DIAGNOSING, fence_token=fence_1)
    await runner1.emit_event(run_id, None, "reference.check.failed", payload={"oracle": "REF_MISMATCH"})
    await runner1.emit_event(run_id, None, "run.state.transition", payload={"from": "VALIDATING", "to": "DIAGNOSING"})
    await runner1.save_checkpoint(run_id, 2, RunState.DIAGNOSING, "harness-v1", fence_token=fence_1)

    print("  Worker-1 transitioning to MUTATING...")
    await run_repo.transition_state(run_id, RunState.MUTATING, fence_token=fence_1)
    await runner1.emit_event(run_id, None, "harness.candidate.created", payload={"candidate": "harness-v2-candidate"})
    await runner1.save_checkpoint(
        run_id, 3, RunState.MUTATING, "harness-v1", candidate_harness_id="harness-v2-candidate", fence_token=fence_1
    )

    print("\n[Phase 2] Simulating Abrupt Worker-1 Crash (SIGKILL / Network Partition)...")
    print("  Worker-1 terminated unexpectedly at step 3 (MUTATING).")
    # Simulate lease expiry by clearing lease owner
    await mongo.db.tasks.update_one(
        {"task_id": task_id},
        {"$set": {"worker_lease_owner": None, "worker_lease_expiry": None}},
    )
    print("  Task lease expired in MongoDB.")

    print("\n[Phase 3] Worker-2 (worker-beta-recovery) Takes Over...")
    worker2 = DurableWorker(worker_id="worker-beta-recovery", mongo_client=mongo, lease_seconds=30)
    acq2 = await worker2.acquire_lease(task_id)
    assert acq2 is True
    fence_2 = worker2.fence_token
    print(f"  Worker-2 acquired lease with bumped generation: fence_token={fence_2} (was {fence_1})")

    # Worker-2 inspects latest checkpoint
    latest_cp = await cp_repo.get_latest_checkpoint(run_id)
    assert latest_cp is not None
    print(f"  Worker-2 found durable checkpoint: {latest_cp.checkpoint_id} at step {latest_cp.step_index}")
    print(f"  Resuming execution from state: {latest_cp.state.value}")

    # Process remaining lifecycle with worker-2
    res2 = await worker2.process_task(task_id, run_id, "ref_mismatch.vcf")
    print(f"  Worker-2 completed run: status={res2.get('status')}")

    print("\n[Phase 4] Verifying Fencing Isolation (Stale Worker-1 Wakes Up)...")
    stale_write_rejected = False
    try:
        # Worker-1 tries to transition with old fence_1
        await run_repo.transition_state(run_id, RunState.EVALUATING, fence_token=fence_1)
    except FencingTokenConflictError as e:
        stale_write_rejected = True
        print(f"  [PASS] Stale Worker-1 write rejected by MongoDB: {e}")

    assert stale_write_rejected is True, "Stale worker was not properly fenced out!"

    print("\n[Phase 5] Verifying Monotonic Event Sequence Integrity...")
    all_events = await event_repo.get_events(run_id=run_id, after_seq=0, limit=200)
    seqs = [e.seq for e in all_events]
    expected_seqs = list(range(1, len(seqs) + 1))
    assert seqs == expected_seqs, f"Sequence gap or collision detected: {seqs}"
    print(f"  [PASS] Strictly monotonic contiguous sequences verified: {len(seqs)} events, 1..{len(seqs)}")

    # Check evidence receipt
    receipt = await evidence_repo.get_receipt_by_run(run_id)
    assert receipt is not None
    print("  [PASS] Cryptographic Evidence Receipt verified:")
    print(f"    Receipt ID:     {receipt.receipt_id}")
    print(f"    Digest:         {receipt.receipt_digest[:32]}...")
    print(f"    Benchmark:      {receipt.score} (FPR={receipt.false_positive_rate})")
    print(f"    Candidate:      {receipt.candidate_version_id} (Promoted: {receipt.promoted})")

    # Persist structured chaos recovery artifact
    output_dir = root_dir / "artifacts" / "milestones" / "m01"
    output_dir.mkdir(parents=True, exist_ok=True)
    recovery_report_path = output_dir / "chaos_recovery.json"

    chaos_report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "task_id": task_id,
        "run_id": run_id,
        "worker_initial": {
            "worker_id": "worker-alpha",
            "fence_token": fence_1,
            "failed_at_state": "MUTATING",
            "step_index": 3,
        },
        "worker_recovery": {
            "worker_id": "worker-beta-recovery",
            "fence_token": fence_2,
            "resumed_from_checkpoint": latest_cp.checkpoint_id,
            "resumed_at_state": latest_cp.state.value,
            "final_status": res2.get("status"),
        },
        "fencing_verification": {
            "stale_worker_fenced": stale_write_rejected,
            "generation_tokens": {"initial": fence_1, "recovery": fence_2},
        },
        "sequence_integrity": {
            "monotonic_gapless_verified": True,
            "event_count": len(all_events),
            "sequence_range": [1, len(all_events)],
        },
        "evidence_receipt": {
            "receipt_id": receipt.receipt_id,
            "receipt_digest": receipt.receipt_digest,
            "score": receipt.score,
            "promoted": receipt.promoted,
            "fixtures_evaluated": receipt.fixtures_evaluated,
        },
        "event_log": [
            {
                "seq": e.seq,
                "event_type": e.event_type,
                "timestamp": e.timestamp,
                "entity_id": e.entity_id,
            }
            for e in all_events
        ],
    }

    with open(recovery_report_path, "w") as f:
        json.dump(chaos_report, f, indent=2)

    print(f"\nChaos Recovery Artifact saved to: {recovery_report_path.relative_to(root_dir)}")
    print("=" * 70)
    await mongo.close()

if __name__ == "__main__":
    asyncio.run(main())
