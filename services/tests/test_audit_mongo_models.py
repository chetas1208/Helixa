from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import bson
import pytest

from services.integrations.mongodb import models as m

REPO_ROOT = Path(__file__).resolve().parents[2]

_PROBE = (
    "from services.integrations.mongodb.models import RunState, validate_state_transition\n"
    "try:\n"
    "    validate_state_transition(RunState.CREATED, RunState.COMPLETED)\n"
    "except ValueError as e:\n"
    "    print(e)\n"
)


def _message_under_hash_seed(seed: str) -> str:
    proc = subprocess.run(
        [sys.executable, "-c", _PROBE],
        cwd=REPO_ROOT,
        env={"PYTHONHASHSEED": seed, "PYTHONPATH": str(REPO_ROOT)},
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    return proc.stdout.strip()


def test_illegal_transition_message_is_deterministic_across_hash_seeds():
    messages = {_message_under_hash_seed(seed) for seed in ("1", "2", "3", "4")}
    assert len(messages) == 1


def test_illegal_transition_message_lists_allowed_targets_sorted():
    with pytest.raises(m.InvalidStateTransitionError) as exc:
        m.validate_state_transition(m.RunState.CREATED, m.RunState.COMPLETED)
    allowed = sorted(s.value for s in m.ALLOWED_RUN_TRANSITIONS[m.RunState.CREATED])
    assert f"Allowed targets: {allowed}" in str(exc.value)


def test_state_graph_is_total_reachable_and_terminals_are_closed():
    assert set(m.ALLOWED_RUN_TRANSITIONS) == set(m.RunState)
    reachable = {m.RunState.CREATED}
    frontier = [m.RunState.CREATED]
    while frontier:
        for nxt in m.ALLOWED_RUN_TRANSITIONS[frontier.pop()]:
            if nxt not in reachable:
                reachable.add(nxt)
                frontier.append(nxt)
    assert reachable == set(m.RunState)
    for terminal in (m.RunState.COMPLETED, m.RunState.FAILED, m.RunState.CANCELLED):
        assert m.ALLOWED_RUN_TRANSITIONS[terminal] == set()
        with pytest.raises(m.InvalidStateTransitionError):
            m.validate_state_transition(terminal, m.RunState.RUNNING)


def test_models_round_trip_through_bson():
    instances = [
        m.DatasetModel(dataset_id="d"),
        m.ArtifactModel(
            artifact_id="a", artifact_sha256="x", filename="f", file_format="vcf", byte_size=1, storage_path="p"
        ),
        m.TaskModel(task_id="t", status=m.TaskStatus.RUNNING),
        m.RunModel(run_id="r", task_id="t", status=m.RunState.PAUSED),
        m.RunEventModel(event_id="e", run_id="r", seq=1, event_type="x"),
        m.CheckpointModel(
            checkpoint_id="c", run_id="r", step_index=0, state=m.RunState.MUTATING, active_harness_id="h"
        ),
        m.HarnessVersionModel(version_id="v", status=m.HarnessStatus.PROMOTED),
        m.HarnessMutationModel(mutation_id="m", parent_version_id="a", candidate_version_id="b", run_id="r"),
        m.EvaluationModel(
            evaluation_id="e",
            run_id="r",
            candidate_version_id="c",
            parent_version_id="p",
            candidate_score="1",
            parent_score="0",
            false_positive_rate=0.0,
            promoted=True,
            receipt_id="x",
        ),
        m.EvidenceReceiptModel(
            receipt_id="r", receipt_digest="d", run_id="r", candidate_version_id="c", score="1", promoted=True
        ),
        m.ResearchMemoryModel(memory_id="m", run_id="r", content="c"),
        m.IntegrationEventModel(event_id="e", component="c", action="a", status="s"),
    ]
    for inst in instances:
        assert type(inst)(**bson.decode(bson.encode(inst.model_dump()))) == inst
