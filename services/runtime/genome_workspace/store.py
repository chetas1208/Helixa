"""File-backed workspace pointer. Local JSON, not an Atlas claim."""

from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.runtime.genome_workspace.reference import (
    ASSEMBLY,
    ASSET_ID,
    CONTIG,
    LICENSE_NOTE,
    base_at,
    checksum,
    window,
)
from services.runtime.population.wright_fisher import (
    FitnessClass,
    SimulationError,
    WrightFisherRequest,
    run_wright_fisher,
)

MAX_GENERATIONS = 2000
HARNESS_ID = "harness-pche-baseline"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def state_path() -> Path:
    override = os.environ.get("V10_STATE_PATH")
    if override:
        return Path(override)
    return Path("artifacts/v10/state.json")


class WorkspaceConflict(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)


class WorkspaceStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path
        self._lock = threading.Lock()

    @property
    def path(self) -> Path:
        if self._path is not None:
            return self._path
        return state_path()

    @path.setter
    def path(self, value: Path | None) -> None:
        self._path = value

    def _empty(self) -> dict[str, Any]:
        return {
            "active_workspace_id": None,
            "selection_version": 0,
            "workspaces": {},
            "proposals": {},
            "genome_edit_proposals": {},
            "simulations": {},
            "idempotency": {},
        }

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return self._empty()
        state = json.loads(self.path.read_text(encoding="utf-8"))
        state.setdefault("proposals", {})
        state.setdefault("genome_edit_proposals", {})
        state.setdefault("simulations", {})
        state.setdefault("idempotency", {})
        state.setdefault("workspaces", {})
        return state

    def _save(self, state: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
        temporary.replace(self.path)

    def describe_reference(self) -> dict[str, Any]:
        text_checksum = checksum()
        return {
            "reference_asset_id": ASSET_ID,
            "assembly": ASSEMBLY,
            "contig": CONTIG,
            "length": _length(),
            "checksum_sha256": text_checksum,
            "official_grch38": False,
            "license_note": LICENSE_NOTE,
        }

    def read_window(self, start: int, end: int) -> dict[str, Any]:
        bases = window(start, end)
        return {
            "assembly": ASSEMBLY,
            "contig": CONTIG,
            "start": start,
            "end": end,
            "bases": bases,
            "coordinate": "1-based inclusive",
            "official_grch38": False,
            "checksum_sha256": checksum(),
        }

    def create_workspace(self, name: str) -> dict[str, Any]:
        with self._lock:
            state = self._load()
            workspace_id = _ident("ws", name, str(len(state["workspaces"])))
            revision = _baseline_revision(workspace_id)
            workspace = {
                "workspace_id": workspace_id,
                "name": name.strip() or "Research workspace",
                "reference_asset_id": ASSET_ID,
                "active_genome_revision_id": revision["genome_revision_id"],
                "active_harness_version_id": HARNESS_ID,
                "revision_counter": 1,
                "status": "ACTIVE",
                "revisions": [revision],
                "created_at": _now(),
                "updated_at": _now(),
            }
            state["workspaces"][workspace_id] = workspace
            if state["active_workspace_id"] is None:
                state["active_workspace_id"] = workspace_id
            self._save(state)
            return _public_workspace(workspace)

    def list_workspaces(self) -> list[dict[str, Any]]:
        state = self._load()
        return [_public_workspace(item) for item in state["workspaces"].values()]

    def get_workspace(self, workspace_id: str) -> dict[str, Any]:
        state = self._load()
        workspace = state["workspaces"].get(workspace_id)
        if workspace is None:
            raise KeyError(workspace_id)
        return _public_workspace(workspace)

    def active(self) -> dict[str, Any] | None:
        state = self._load()
        workspace_id = state["active_workspace_id"]
        if workspace_id is None:
            return None
        return _public_workspace(state["workspaces"][workspace_id])

    def select(self, workspace_id: str, expected_counter: int | None) -> dict[str, Any]:
        with self._lock:
            state = self._load()
            workspace = state["workspaces"].get(workspace_id)
            if workspace is None:
                raise KeyError(workspace_id)
            if workspace.get("status") == "ARCHIVED":
                raise ValueError("archived workspaces cannot be selected")
            if expected_counter is not None and workspace["revision_counter"] != expected_counter:
                raise WorkspaceConflict(
                    f"revision_counter is {workspace['revision_counter']}, not {expected_counter}"
                )
            state["active_workspace_id"] = workspace_id
            state["selection_version"] = int(state.get("selection_version", 0)) + 1
            self._save(state)
            return _public_workspace(workspace)

    def branch(self, workspace_id: str, name: str) -> dict[str, Any]:
        with self._lock:
            state = self._load()
            source = state["workspaces"].get(workspace_id)
            if source is None:
                raise KeyError(workspace_id)
            revision = _current_revision(source)
            workspace_id_new = _ident("ws", name, source["workspace_id"])
            cloned = {
                **revision,
                "genome_revision_id": _ident("rev", workspace_id_new, revision["sequence_sha256"][:12]),
                "parent_revision_id": revision["genome_revision_id"],
            }
            workspace = {
                "workspace_id": workspace_id_new,
                "name": name.strip() or f"{source['name']} branch",
                "reference_asset_id": ASSET_ID,
                "active_genome_revision_id": cloned["genome_revision_id"],
                "active_harness_version_id": HARNESS_ID,
                "revision_counter": 1,
                "status": "ACTIVE",
                "revisions": [cloned],
                "created_at": _now(),
                "updated_at": _now(),
            }
            state["workspaces"][workspace_id_new] = workspace
            self._save(state)
            return _public_workspace(workspace)

    def propose(self, workspace_id: str, position: int, alt: str, note: str) -> dict[str, Any]:
        alt = alt.upper()
        if alt not in {"A", "C", "G", "T"} or len(alt) != 1:
            raise ValueError("alt must be one of A, C, G, T")
        try:
            ref = base_at(position)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        with self._lock:
            state = self._load()
            workspace = state["workspaces"].get(workspace_id)
            if workspace is None:
                raise KeyError(workspace_id)
            committed = _sequence_at(workspace, position)
            proposal_id = _ident("prop", workspace_id, f"{position}:{alt}:{workspace['revision_counter']}")
            if alt == committed:
                status = "REJECTED"
                reason = "alt matches the current allele"
            elif committed != ref:
                status = "NEEDS_REVIEW"
                reason = (
                    f"baseline REF is {ref}; the workspace currently has {committed}. "
                    "Commit confirms you mean to replace the current allele."
                )
            else:
                status = "READY"
                reason = ""
            proposal = {
                "proposal_id": proposal_id,
                "workspace_id": workspace_id,
                "assembly": ASSEMBLY,
                "contig": CONTIG,
                "position": position,
                "ref": ref,
                "current_allele": committed,
                "alt": alt,
                "note": note[:240],
                "status": status,
                "reason": reason,
                "applied": False,
            }
            state["proposals"][proposal_id] = proposal
            self._save(state)
            return proposal

    def commit(
        self,
        workspace_id: str,
        proposal_id: str,
        expected_counter: int,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            state = self._load()
            if idempotency_key:
                cached = state["idempotency"].get(f"commit:{idempotency_key}")
                if cached is not None:
                    return cached
            workspace = state["workspaces"].get(workspace_id)
            proposal = state["proposals"].get(proposal_id)
            if workspace is None or proposal is None:
                raise KeyError("workspace or proposal")
            if proposal["workspace_id"] != workspace_id:
                raise ValueError("proposal belongs to another workspace")
            if proposal["status"] == "REJECTED":
                raise ValueError(proposal["reason"] or "proposal was rejected")
            if workspace["revision_counter"] != expected_counter:
                raise WorkspaceConflict(
                    f"revision_counter is {workspace['revision_counter']}, not {expected_counter}"
                )
            parent = _current_revision(workspace)
            edit = {
                "position": proposal["position"],
                "ref": proposal["ref"],
                "alt": proposal["alt"],
                "current_allele_at_commit": proposal["current_allele"],
            }
            if base_at(edit["position"]) != edit["ref"]:
                raise ValueError("baseline REF changed under the proposal")
            edits = [*parent["edits"], edit]
            bases = _edited_window(1, 48, edits)
            revision = {
                "genome_revision_id": _ident("rev", workspace_id, str(workspace["revision_counter"] + 1)),
                "parent_revision_id": parent["genome_revision_id"],
                "edits": edits,
                "preview_1_48": bases,
                "sequence_sha256": hashlib.sha256(bases.encode("ascii")).hexdigest(),
                "harness_version_id": HARNESS_ID,
                "created_at": _now(),
            }
            workspace["revisions"].append(revision)
            workspace["active_genome_revision_id"] = revision["genome_revision_id"]
            workspace["revision_counter"] += 1
            workspace["updated_at"] = _now()
            proposal["applied"] = True
            proposal["status"] = "COMMITTED"
            public = _public_workspace(workspace)
            if idempotency_key:
                state["idempotency"][f"commit:{idempotency_key}"] = public
            self._save(state)
            return public

    def intelligence(self, workspace_id: str) -> dict[str, Any]:
        workspace = self.get_workspace(workspace_id)
        revision = workspace["active_revision"]
        return {
            "workspace_id": workspace_id,
            "genome_revision_id": revision["genome_revision_id"],
            "harness_version_id": workspace["active_harness_version_id"],
            "same_identifier": False,
            "what_changed": revision["edits"],
            "what_was_computed": "Reference slice check only. No phenotype model ran.",
            "hypothetical": "Any later population run is a separate simulation, not this revision.",
            "harness_adapted": "The analysis harness id is unchanged. Genome edits do not promote a harness.",
            "trust": "The preview hash covers bases 1-48 after the listed substitutions. It is not a genome assembly.",
            "official_grch38": False,
        }

    def simulate(self, body: dict[str, Any], idempotency_key: str | None) -> dict[str, Any]:
        with self._lock:
            state = self._load()
            if idempotency_key and idempotency_key in state["idempotency"]:
                return state["simulations"][state["idempotency"][idempotency_key]]
            workspace_id = body.get("workspace_id") or state["active_workspace_id"]
            if not workspace_id or workspace_id not in state["workspaces"]:
                raise KeyError("active workspace")
            workspace = state["workspaces"][workspace_id]
            horizon = float(body.get("horizon_years", 2000))
            generation_time = float(body.get("generation_time_years", 25))
            if generation_time <= 0:
                raise SimulationError("generation_time_years must be positive")
            generations = int(horizon / generation_time)
            allow_accel = bool(body.get("allow_acceleration", False))
            reps = int(body.get("replicates", 1))
            has_v15_features = (
                allow_accel
                or reps > 1
                or "dominance_h" in body
                or "environment_selection_model" in body
                or "carrying_capacity" in body
            )
            if generations > MAX_GENERATIONS and not allow_accel:
                raise SimulationError(
                    f"{horizon:g} years at {generation_time:g} years/generation is {generations} generations. "
                    f"The budget is {MAX_GENERATIONS} generations "
                    f"({MAX_GENERATIONS * generation_time:g} model years). "
                    "Narrow the horizon or lengthen the declared generation time. "
                    "Generations are not skipped silently."
                )
            fitness = FitnessClass(body.get("fitness_class", FitnessClass.EDUCATIONAL_TOY.value))
            environment = {
                "temperature_c": body.get("temperature_c"),
                "precipitation_mm_year": body.get("precipitation_mm_year"),
                **(body.get("environment") or {}),
            }
            cleaned_env = {key: value for key, value in environment.items() if value is not None}

            if has_v15_features or (generations > MAX_GENERATIONS and allow_accel):
                from services.runtime.population.engine_v15 import (
                    EngineMode,
                    EnvironmentalSelectionModel,
                    V15SimulationRequest,
                    run_v15_evolution,
                )
                env_model = None
                if body.get("environment_selection_model"):
                    env_model = EnvironmentalSelectionModel(**body["environment_selection_model"])
                v15_req = V15SimulationRequest(
                    initial_frequency=float(body.get("initial_frequency", 0.5)),
                    population_size=int(body.get("population_size", 80)),
                    carrying_capacity=int(body.get("carrying_capacity", 1000)),
                    intrinsic_growth_rate=float(body.get("intrinsic_growth_rate", 0.0)),
                    generations=generations,
                    generation_time_years=generation_time,
                    mutation_forward=float(body.get("mutation_forward", 0.0)),
                    mutation_reverse=float(body.get("mutation_reverse", 0.0)),
                    migration_rate=float(body.get("migration_rate", 0.0)),
                    migrant_frequency=float(body.get("migrant_frequency", 0.0)),
                    selection_coefficient=float(body.get("selection_coefficient", 0.0)),
                    dominance_h=float(body.get("dominance_h", 0.5)),
                    fitness_class=fitness,
                    seed=int(body.get("seed", 1)),
                    ploidy=int(body.get("ploidy", 1)),
                    replicates=reps,
                    allow_acceleration=allow_accel,
                    engine_mode=EngineMode(body.get("engine_mode", EngineMode.MODE_A_WRIGHT_FISHER.value)),
                    environment=cleaned_env,
                    environment_selection_model=env_model,
                )
                result = run_v15_evolution(v15_req)
            else:
                request = WrightFisherRequest(
                    initial_frequency=float(body.get("initial_frequency", 0.5)),
                    population_size=int(body.get("population_size", 80)),
                    generations=generations,
                    generation_time_years=generation_time,
                    mutation_forward=float(body.get("mutation_forward", 0.0)),
                    migration_rate=float(body.get("migration_rate", 0.0)),
                    migrant_frequency=float(body.get("migrant_frequency", 0.0)),
                    selection_coefficient=float(body.get("selection_coefficient", 0.0)),
                    fitness_class=fitness,
                    seed=int(body.get("seed", 1)),
                    ploidy=int(body.get("ploidy", 1)),
                    environment=cleaned_env,
                )
                result = run_wright_fisher(request)
            simulation_id = _ident("sim", workspace_id, result["result_sha256"][:12])
            record = {
                "simulation_id": simulation_id,
                "workspace_id": workspace_id,
                "genome_revision_id": workspace["active_genome_revision_id"],
                "harness_version_id": HARNESS_ID,
                "playback_seconds": 60,
                **result,
            }
            record["narrative"] = _narrative(record)
            state["simulations"][simulation_id] = record
            if idempotency_key:
                state["idempotency"][idempotency_key] = simulation_id
            self._save(state)
            return record

    def list_simulations(self, workspace_id: str) -> list[dict[str, Any]]:
        state = self._load()
        if workspace_id not in state["workspaces"]:
            raise KeyError(workspace_id)
        return [item for item in state["simulations"].values() if item["workspace_id"] == workspace_id]

    def snapshot(self) -> dict[str, Any]:
        state = self._load()
        current = self.active()
        latest = None
        if current is not None:
            runs = [item for item in state["simulations"].values() if item["workspace_id"] == current["workspace_id"]]
            latest = runs[-1]["simulation_id"] if runs else None
        return {
            "selection_version": int(state.get("selection_version", 0)),
            "workspace": current,
            "body": self.body_descriptor(current["workspace_id"]) if current else None,
            "latest_simulation_id": latest,
            "harness_version_id": current["active_harness_version_id"] if current else None,
            "genome_revision_id": current["active_genome_revision_id"] if current else None,
        }

    def body_descriptor(self, workspace_id: str) -> dict[str, Any]:
        workspace = self.get_workspace(workspace_id)
        return {
            "workspace_id": workspace_id,
            "genome_revision_id": workspace["active_genome_revision_id"],
            "effect_class": "ILLUSTRATIVE",
            "anatomy_changed": False,
            "reason": "No evidence-backed genotype-to-anatomy map. The body stays a navigation drawing.",
            "limitations": ["DIRECT_SEQUENCE edits do not change body geometry."],
        }

    def genome_lineage(self, workspace_id: str) -> dict[str, Any]:
        state = self._load()
        workspace = state["workspaces"].get(workspace_id)
        if workspace is None:
            raise KeyError(workspace_id)
        nodes = [
            {
                "genome_revision_id": revision["genome_revision_id"],
                "parent_revision_id": revision["parent_revision_id"],
                "edit_count": len(revision["edits"]),
                "sequence_sha256": revision["sequence_sha256"],
                "edits_summary": [_edit_summary(edit) for edit in revision["edits"]],
            }
            for revision in workspace["revisions"]
        ]
        return {"workspace_id": workspace_id, "kind": "GENOME_REVISION", "nodes": nodes}

    def harness_lineage(self, workspace_id: str) -> dict[str, Any]:
        workspace = self.get_workspace(workspace_id)
        return {
            "workspace_id": workspace_id,
            "kind": "ANALYSIS_HARNESS",
            "distinct_from_genome": workspace["active_harness_version_id"] != workspace["active_genome_revision_id"],
            "nodes": [
                {
                    "harness_version_id": workspace["active_harness_version_id"],
                    "parent_harness_version_id": None,
                    "note": "Existing analysis policy. A nucleotide edit does not create a harness version.",
                }
            ],
        }

    def rename(self, workspace_id: str, name: str) -> dict[str, Any]:
        with self._lock:
            state = self._load()
            workspace = state["workspaces"].get(workspace_id)
            if workspace is None:
                raise KeyError(workspace_id)
            workspace["name"] = name.strip() or workspace["name"]
            workspace["updated_at"] = _now()
            self._save(state)
            return _public_workspace(workspace)

    def archive(self, workspace_id: str) -> dict[str, Any]:
        with self._lock:
            state = self._load()
            workspace = state["workspaces"].get(workspace_id)
            if workspace is None:
                raise KeyError(workspace_id)
            workspace["status"] = "ARCHIVED"
            workspace["updated_at"] = _now()
            if state["active_workspace_id"] == workspace_id:
                state["active_workspace_id"] = None
                state["selection_version"] = int(state.get("selection_version", 0)) + 1
            self._save(state)
            return _public_workspace(workspace)

    def interpret(self, workspace_id: str, text: str) -> dict[str, Any]:
        import re

        match = re.search(
            r"(?:position|base)\s+(\d+)(?:\s+from\s+([ACGT]))?\s+to\s+([ACGT])\b",
            text,
            flags=re.IGNORECASE,
        )
        if match is None:
            return {
                "status": "NEEDS_CLARIFICATION",
                "proposals": [],
                "reason": "Say a position and a base, for example: change position 6 from G to A.",
            }
        position = int(match.group(1))
        stated_ref = match.group(2).upper() if match.group(2) else None
        alt = match.group(3).upper()
        if stated_ref is not None:
            try:
                actual = base_at(position)
            except ValueError as exc:
                raise ValueError(str(exc)) from exc
            if stated_ref != actual:
                return {
                    "status": "REJECTED",
                    "proposals": [],
                    "reason": f"baseline at {position} is {actual}, not {stated_ref}",
                }
        proposal = self.propose(workspace_id, position, alt, text[:240])
        return {"status": proposal["status"], "proposals": [proposal], "reason": proposal["reason"]}

    def create_genome_edit_proposal(self, body: dict[str, Any]) -> dict[str, Any]:
        """V14 proposal. Does not commit a revision. Anatomy selection is not stored as a workspace change."""
        from services.runtime.genome_edit.references import resolve_reference, try_base_at

        workspace_id = body["workspace_id"]
        alt = str(body.get("alt") or "").upper()
        if alt not in {"A", "C", "G", "T"}:
            raise ValueError("alt must be one of A, C, G, T")
        position = int(body["position"])
        if position < 1:
            raise ValueError("position must be a 1-based genomic coordinate")
        source = body.get("source") or "manual"
        if source not in {"text", "voice", "manual"}:
            raise ValueError("source must be text, voice, or manual")
        resolved = resolve_reference(
            body.get("reference_asset_id"),
            body.get("locus_id"),
            body.get("contig"),
        )
        ref, ref_error = try_base_at(resolved["reference_asset_id"], position, resolved.get("locus_id") or body.get("locus_id"))
        with self._lock:
            state = self._load()
            workspace = state["workspaces"].get(workspace_id)
            if workspace is None:
                raise KeyError(workspace_id)
            parent_id = body.get("parent_revision_id") or workspace["active_genome_revision_id"]
            try:
                current = _sequence_at(
                    workspace,
                    position,
                    resolved["reference_asset_id"],
                    resolved.get("locus_id") or body.get("locus_id"),
                )
            except ValueError:
                current = ref or ""
            stated = str(body.get("ref") or body.get("stated_ref") or "").upper()
            if ref is None:
                reference_allele = stated
                current_allele = current if resolved["reference_asset_id"] == ASSET_ID else current
            else:
                reference_allele = stated or ref
                current_allele = current
            proposal_id = _ident("gep", workspace_id, f"{resolved['reference_asset_id']}:{position}:{alt}:{workspace['revision_counter']}")
            contig = resolved["contig"] or body.get("contig") or CONTIG
            assembly = resolved["assembly"]
            locus_id = resolved.get("locus_id") or body.get("locus_id")
            proposal = {
                "proposal_id": proposal_id,
                "workspace_id": workspace_id,
                "parent_revision_id": parent_id,
                "reference_asset_id": resolved["reference_asset_id"],
                "locus_id": locus_id,
                "assembly": assembly,
                "contig": contig,
                "position": position,
                "reference_allele": reference_allele,
                "current_allele": current_allele,
                "alternate_allele": alt,
                "normalized_representation": _normalized(contig, position, reference_allele or "?", alt, assembly),
                "validation_status": "pending",
                "checks": [],
                "consequence_status": "not-computed",
                "consequence": None,
                "overlapping_features": _overlapping_features(resolved.get("locus"), position),
                "evidence_refs": [],
                "source": source,
                "anatomy_id": body.get("anatomy_id"),
                "gene_id": resolved.get("gene_id") or body.get("gene_id"),
                "gene_symbol": resolved.get("gene_symbol") or body.get("gene_symbol"),
                "note": str(body.get("note") or "")[:240],
                "created_at": _now(),
                "ref_lookup_error": ref_error,
            }
            state["genome_edit_proposals"][proposal_id] = proposal
            self._save(state)
            return _public_genome_edit_proposal(proposal)

    def get_genome_edit_proposal(self, proposal_id: str) -> dict[str, Any]:
        state = self._load()
        proposal = state["genome_edit_proposals"].get(proposal_id)
        if proposal is None:
            raise KeyError(proposal_id)
        return _public_genome_edit_proposal(proposal)

    def validate_genome_edit_proposal(self, proposal_id: str) -> dict[str, Any]:
        from services.runtime.genome_edit.references import try_base_at
        from services.runtime.genome_edit.vep import lookup_consequence

        with self._lock:
            state = self._load()
            proposal = state["genome_edit_proposals"].get(proposal_id)
            if proposal is None:
                raise KeyError(proposal_id)
            workspace = state["workspaces"].get(proposal["workspace_id"])
            if workspace is None:
                raise KeyError(proposal["workspace_id"])
            checks: list[dict[str, Any]] = []
            actual, ref_error = try_base_at(
                proposal["reference_asset_id"],
                proposal["position"],
                proposal.get("locus_id"),
            )
            if ref_error:
                checks.append(
                    {
                        "check": "ref_matches_pinned_reference",
                        "passed": False,
                        "detail": ref_error,
                    }
                )
            else:
                stored = proposal.get("reference_allele") or actual
                if stored and actual and stored != actual:
                    checks.append(
                        {
                            "check": "ref_matches_pinned_reference",
                            "passed": False,
                            "detail": f"proposal REF is {stored}; pinned reference is {actual}",
                        }
                    )
                    proposal["reference_allele"] = actual
                else:
                    proposal["reference_allele"] = actual or stored
                    checks.append(
                        {
                            "check": "ref_matches_pinned_reference",
                            "passed": True,
                            "detail": f"pinned reference at {proposal['position']} is {proposal['reference_allele']}",
                        }
                    )
            alt = proposal["alternate_allele"]
            checks.append(
                {
                    "check": "alt_is_nucleotide",
                    "passed": alt in {"A", "C", "G", "T"},
                    "detail": "alternate allele must be A, C, G or T",
                }
            )
            try:
                current = _sequence_at(
                    workspace,
                    proposal["position"],
                    proposal["reference_asset_id"],
                    proposal.get("locus_id"),
                )
            except ValueError:
                current = actual or proposal.get("current_allele") or ""
            if proposal["reference_asset_id"] != ASSET_ID and actual is None:
                current = proposal.get("current_allele") or current
            proposal["current_allele"] = current
            checks.append(
                {
                    "check": "alt_differs_from_current",
                    "passed": bool(alt) and alt != current,
                    "detail": (
                        "alternate matches the current allele"
                        if alt == current
                        else f"current allele is {current or 'unknown'}"
                    ),
                }
            )
            parent = _current_revision(workspace)
            parent_ok = proposal["parent_revision_id"] == parent["genome_revision_id"]
            checks.append(
                {
                    "check": "parent_revision_current",
                    "passed": parent_ok,
                    "detail": (
                        "parent revision is still active"
                        if parent_ok
                        else f"active revision is {parent['genome_revision_id']}"
                    ),
                }
            )
            proposal["checks"] = checks
            required = [item for item in checks if item["check"] != "parent_revision_current"]
            if any(not item["passed"] and "unavailable" in item["detail"].lower() for item in checks if item["check"] == "ref_matches_pinned_reference"):
                proposal["validation_status"] = "inconclusive"
            elif all(item["passed"] for item in required) and proposal["reference_allele"]:
                proposal["validation_status"] = "valid"
            else:
                proposal["validation_status"] = "invalid"
            if proposal["assembly"] == "GRCh38":
                consequence = lookup_consequence(
                    proposal["contig"],
                    proposal["position"],
                    proposal["alternate_allele"],
                    proposal["assembly"],
                )
                proposal["consequence_status"] = consequence["consequence_status"]
                proposal["consequence"] = consequence["consequence"]
            else:
                proposal["consequence_status"] = "unavailable"
                proposal["consequence"] = None
            proposal["normalized_representation"] = _normalized(
                proposal["contig"],
                proposal["position"],
                proposal["reference_allele"] or "?",
                proposal["alternate_allele"],
                proposal["assembly"],
            )
            self._save(state)
            return _public_genome_edit_proposal(proposal)

    def apply_genome_edit_proposal(
        self,
        proposal_id: str,
        expected_counter: int,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            state = self._load()
            if idempotency_key:
                cached = state["idempotency"].get(f"apply:{idempotency_key}")
                if cached is not None:
                    return cached
            proposal = state["genome_edit_proposals"].get(proposal_id)
            if proposal is None:
                raise KeyError(proposal_id)
            if proposal.get("validation_status") != "valid":
                raise ValueError("proposal validation_status must be valid")
            workspace = state["workspaces"].get(proposal["workspace_id"])
            if workspace is None:
                raise KeyError(proposal["workspace_id"])
            if workspace["revision_counter"] != expected_counter:
                raise WorkspaceConflict(
                    f"revision_counter is {workspace['revision_counter']}, not {expected_counter}"
                )
            parent = _current_revision(workspace)
            if proposal["parent_revision_id"] != parent["genome_revision_id"]:
                raise WorkspaceConflict(
                    f"parent revision is {parent['genome_revision_id']}, not {proposal['parent_revision_id']}"
                )
            edit = {
                "position": proposal["position"],
                "ref": proposal["reference_allele"],
                "alt": proposal["alternate_allele"],
                "current_allele_at_commit": proposal["current_allele"],
                "reference_asset_id": proposal["reference_asset_id"],
                "locus_id": proposal.get("locus_id"),
                "assembly": proposal["assembly"],
                "contig": proposal["contig"],
                "gene_id": proposal.get("gene_id"),
                "gene_symbol": proposal.get("gene_symbol"),
                "anatomy_ids": [proposal["anatomy_id"]] if proposal.get("anatomy_id") else [],
                "proposal_id": proposal["proposal_id"],
            }
            edits = [*parent["edits"], edit]
            bases = _edited_window(1, 48, edits)
            revision = {
                "genome_revision_id": _ident("rev", workspace["workspace_id"], str(workspace["revision_counter"] + 1)),
                "parent_revision_id": parent["genome_revision_id"],
                "edits": edits,
                "preview_1_48": bases,
                "sequence_sha256": hashlib.sha256(bases.encode("ascii")).hexdigest(),
                "harness_version_id": HARNESS_ID,
                "created_at": _now(),
            }
            workspace["revisions"].append(revision)
            workspace["active_genome_revision_id"] = revision["genome_revision_id"]
            workspace["revision_counter"] += 1
            workspace["updated_at"] = _now()
            proposal["applied"] = True
            public = _public_workspace(workspace)
            receipt = {
                "proposal_id": proposal_id,
                "workspace_id": workspace["workspace_id"],
                "genome_revision_id": revision["genome_revision_id"],
                "applied_at": _now(),
            }
            result = {"workspace": public, "revision": revision, "receipt": receipt}
            if idempotency_key:
                state["idempotency"][f"apply:{idempotency_key}"] = result
            self._save(state)
            return result

    def playback(self, simulation_id: str, duration_seconds: int = 60) -> dict[str, Any]:
        record = self.get_simulation(simulation_id)
        return {
            "simulation_id": simulation_id,
            "duration_seconds": duration_seconds,
            "simulated_years": record["simulated_years"],
            "generations_executed": record["generations_executed"],
            "result_sha256": record["result_sha256"],
            "interpolation": "DISPLAY_ONLY",
            "frames": record["frames"],
            "science_unchanged_by_playback_duration": True,
        }

    def get_simulation(self, simulation_id: str) -> dict[str, Any]:
        state = self._load()
        record = state["simulations"].get(simulation_id)
        if record is None:
            raise KeyError(simulation_id)
        return record


def _length() -> int:
    from services.runtime.genome_workspace.reference import sequence

    return len(sequence())


def _ident(*parts: str) -> str:
    token = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:12]
    return f"{parts[0]}-{token}"


def _baseline_revision(workspace_id: str) -> dict[str, Any]:
    preview = window(1, 48)
    return {
        "genome_revision_id": _ident("rev", workspace_id, "baseline"),
        "parent_revision_id": None,
        "edits": [],
        "preview_1_48": preview,
        "sequence_sha256": hashlib.sha256(preview.encode("ascii")).hexdigest(),
        "harness_version_id": HARNESS_ID,
        "created_at": _now(),
    }


def _current_revision(workspace: dict[str, Any]) -> dict[str, Any]:
    revision_id = workspace["active_genome_revision_id"]
    for revision in workspace["revisions"]:
        if revision["genome_revision_id"] == revision_id:
            return revision
    raise KeyError(revision_id)


def _public_workspace(workspace: dict[str, Any]) -> dict[str, Any]:
    revision = _current_revision(workspace)
    return {
        "workspace_id": workspace["workspace_id"],
        "name": workspace["name"],
        "reference_asset_id": workspace["reference_asset_id"],
        "assembly": ASSEMBLY,
        "official_grch38": False,
        "active_genome_revision_id": revision["genome_revision_id"],
        "active_harness_version_id": workspace["active_harness_version_id"],
        "revision_counter": workspace["revision_counter"],
        "edit_count": len(revision["edits"]),
        "active_revision": revision,
        "status": workspace["status"],
        "updated_at": workspace["updated_at"],
    }


def _edit_reference_id(edit: dict[str, Any]) -> str:
    """Edits without a reference_asset_id are the synthetic contig (V10)."""
    return edit.get("reference_asset_id") or ASSET_ID


def _edits_for_reference(edits: list[dict[str, Any]], reference_asset_id: str) -> list[dict[str, Any]]:
    return [edit for edit in edits if _edit_reference_id(edit) == reference_asset_id]


def _sequence_at(
    workspace: dict[str, Any],
    position: int,
    reference_asset_id: str | None = None,
    locus_id: str | None = None,
) -> str:
    target = reference_asset_id or ASSET_ID
    if target != ASSET_ID:
        allele = None
        for edit in _edits_for_reference(_current_revision(workspace)["edits"], target):
            if edit["position"] == position:
                allele = edit["alt"]
        if allele is not None:
            return allele
        from services.runtime.genome_edit.references import try_base_at

        base, error = try_base_at(target, position, locus_id)
        if error or base is None:
            raise ValueError(error or "reference base unavailable")
        return base
    allele = base_at(position)
    for edit in _edits_for_reference(_current_revision(workspace)["edits"], ASSET_ID):
        if edit["position"] == position:
            allele = edit["alt"]
    return allele


def _edited_window(start: int, end: int, edits: list[dict[str, Any]]) -> str:
    """Synthetic preview window. GRCh38 edits must not land on this contig."""
    chars = list(window(start, end))
    for edit in _edits_for_reference(edits, ASSET_ID):
        if start <= edit["position"] <= end:
            chars[edit["position"] - start] = edit["alt"]
    return "".join(chars)


def _edit_summary(edit: dict[str, Any]) -> dict[str, Any]:
    return {
        "gene_symbol": edit.get("gene_symbol"),
        "locus_id": edit.get("locus_id"),
        "position": edit["position"],
        "ref": edit["ref"],
        "alt": edit["alt"],
        "anatomy_ids": list(edit.get("anatomy_ids") or []),
    }


def _normalized(contig: str, position: int, ref: str, alt: str, assembly: str) -> str:
    return f"{contig}-{position}-{ref}-{alt} ({assembly}, VCF-style)"


def _overlapping_features(locus: dict[str, Any] | None, position: int) -> list[dict[str, Any]]:
    if not locus:
        return []
    hits = []
    for feature in locus.get("features") or []:
        try:
            start = int(feature.get("start"))
            end = int(feature.get("end"))
        except (TypeError, ValueError):
            continue
        if start <= position <= end:
            hits.append(
                {
                    "feature_type": feature.get("feature_type") or "feature",
                    "id": feature.get("id") or "",
                    "transcript_id": feature.get("transcript_id"),
                }
            )
    return hits


def _public_genome_edit_proposal(proposal: dict[str, Any]) -> dict[str, Any]:
    return {
        "proposal_id": proposal["proposal_id"],
        "workspace_id": proposal["workspace_id"],
        "parent_revision_id": proposal["parent_revision_id"],
        "reference_asset_id": proposal["reference_asset_id"],
        "locus_id": proposal.get("locus_id"),
        "assembly": proposal["assembly"],
        "contig": proposal["contig"],
        "position": proposal["position"],
        "reference_allele": proposal["reference_allele"],
        "current_allele": proposal["current_allele"],
        "alternate_allele": proposal["alternate_allele"],
        "normalized_representation": proposal.get("normalized_representation"),
        "validation_status": proposal["validation_status"],
        "checks": list(proposal.get("checks") or []),
        "consequence_status": proposal.get("consequence_status") or "not-computed",
        "consequence": proposal.get("consequence"),
        "overlapping_features": list(proposal.get("overlapping_features") or []),
        "evidence_refs": list(proposal.get("evidence_refs") or []),
        "source": proposal["source"],
        "anatomy_id": proposal.get("anatomy_id"),
        "created_at": proposal["created_at"],
    }


def _narrative(record: dict[str, Any]) -> str:
    frames = record["frames"]
    start = frames[0]["allele_frequency"]
    end = frames[-1]["allele_frequency"]
    pop = record.get("population_size", record.get("initial_population_size", 100))
    fit_note = record.get("fitness_note", f"effective_s={record.get('effective_selection_coefficient', 0.0)}")
    return (
        f"Wright–Fisher locus, seed {record['seed']}, "
        f"N={pop}, {record['generations_executed']} generations "
        f"({record['simulated_years']:g} model years at {record['generation_time_years']:g} years each). "
        f"Focal allele frequency moved from {start:.4f} to {end:.4f}. "
        f"Fitness class {record['fitness_class']}: {fit_note}. "
        f"Climate inputs are {record.get('environment_effects') or 'absent'}. "
        "This is not a prediction that an organism would survive, reproduce, or change shape."
    )
