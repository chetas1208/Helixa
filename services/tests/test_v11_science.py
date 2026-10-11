"""Independent checks for the diploid step. Expected numbers are written here, not copied from the engine."""

import pytest

from services.runtime.genome_workspace.catalog import parameter_specs
from services.runtime.genome_workspace.store import WorkspaceStore
from services.runtime.population.wright_fisher import (
    FitnessClass,
    SimulationError,
    WrightFisherRequest,
    diploid_selection_frequency,
    migration_frequency,
    run_wright_fisher,
)


def test_diploid_selection_matches_a_hand_computed_ratio():
    # p=0.25, w_aa=1, w_Aa=1, w_AA=2
    # mean = 0.0625*2 + 2*0.25*0.75*1 + 0.5625*1 = 1.0625
    # numerator = 0.0625*2 + 0.25*0.75*1 = 0.3125
    assert diploid_selection_frequency(0.25, 1.0, 1.0, 2.0) == pytest.approx(0.3125 / 1.0625)


def test_equal_diploid_fitness_does_not_move_the_deterministic_frequency():
    assert diploid_selection_frequency(0.37, 1.0, 1.0, 1.0) == pytest.approx(0.37)


def test_zero_mean_fitness_is_rejected():
    with pytest.raises(SimulationError, match="mean fitness"):
        diploid_selection_frequency(0.5, 0.0, 0.0, 0.0)


def test_migration_endpoints_are_the_declared_mixture():
    assert migration_frequency(0.2, 0.0, 0.9) == pytest.approx(0.2)
    assert migration_frequency(0.2, 1.0, 0.9) == pytest.approx(0.9)


def test_zero_mutation_cannot_create_an_allele_that_is_absent():
    result = run_wright_fisher(
        WrightFisherRequest(
            initial_frequency=0.0,
            population_size=30,
            generations=12,
            generation_time_years=25,
            mutation_forward=0.0,
            mutation_reverse=0.0,
            ploidy=2,
            seed=4,
        )
    )
    assert all(frame["allele_frequency"] == 0.0 for frame in result["frames"])


def test_one_generation_drift_variance_is_near_the_binomial_formula():
    frequency = 0.4
    individuals = 50
    copies = 2 * individuals
    expected = frequency * (1.0 - frequency) / copies
    draws = []
    for seed in range(300):
        result = run_wright_fisher(
            WrightFisherRequest(
                initial_frequency=frequency,
                population_size=individuals,
                generations=1,
                generation_time_years=25,
                selection_coefficient=0.0,
                ploidy=2,
                seed=seed,
                fitness_class=FitnessClass.EDUCATIONAL_TOY,
            )
        )
        draws.append(result["frames"][-1]["allele_frequency"])
    mean = sum(draws) / len(draws)
    variance = sum((item - mean) ** 2 for item in draws) / (len(draws) - 1)
    assert 0.55 * expected < variance < 1.7 * expected


def test_beneficial_mean_rises_and_deleterious_mean_falls():
    def mean_end(selection: float) -> float:
        ends = []
        for seed in range(24):
            result = run_wright_fisher(
                WrightFisherRequest(
                    initial_frequency=0.2,
                    population_size=80,
                    generations=30,
                    generation_time_years=25,
                    selection_coefficient=selection,
                    ploidy=2,
                    seed=seed,
                    fitness_class=FitnessClass.USER_ASSUMED,
                )
            )
            ends.append(result["frames"][-1]["allele_frequency"])
        return sum(ends) / len(ends)

    assert mean_end(1.0) > 0.2
    assert mean_end(-0.8) < 0.2


def test_same_diploid_seed_matches_and_selection_changes_the_hash():
    common = dict(
        initial_frequency=0.5,
        population_size=40,
        generations=15,
        generation_time_years=20,
        ploidy=2,
        seed=9,
        fitness_class=FitnessClass.USER_ASSUMED,
    )
    neutral = run_wright_fisher(WrightFisherRequest(selection_coefficient=0.0, **common))
    again = run_wright_fisher(WrightFisherRequest(selection_coefficient=0.0, **common))
    selected = run_wright_fisher(WrightFisherRequest(selection_coefficient=0.5, **common))
    assert neutral["result_sha256"] == again["result_sha256"]
    assert neutral["result_sha256"] != selected["result_sha256"]
    assert neutral["engine_version"] == "v11-diploid-1"


def test_climate_parameter_is_not_modeled_and_selection_is():
    by_id = {item["id"]: item["effect_status"] for item in parameter_specs()}
    assert by_id["temperature_c"] == "NOT_MODELED"
    assert by_id["recombination_rate"] == "NOT_MODELED"
    assert by_id["selection_coefficient"] == "ACTIVE_MODELED"


def test_library_selection_restores_the_edited_workspace(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    first = store.create_workspace("alpha")
    from services.runtime.genome_workspace.reference import base_at

    ref = base_at(8)
    alt = "C" if ref != "C" else "G"
    proposal = store.propose(first["workspace_id"], 8, alt, "")
    edited = store.commit(first["workspace_id"], proposal["proposal_id"], first["revision_counter"])
    second = store.create_workspace("beta")
    store.select(second["workspace_id"], second["revision_counter"])
    assert store.active()["edit_count"] == 0
    assert store.active()["workspace_id"] == second["workspace_id"]
    store.select(edited["workspace_id"], edited["revision_counter"])
    restored = store.active()
    assert restored["workspace_id"] == edited["workspace_id"]
    assert restored["edit_count"] == 1
    assert restored["active_revision"]["preview_1_48"][7] == alt
    neutral = store.simulate(
        {
            "workspace_id": restored["workspace_id"],
            "horizon_years": 100,
            "generation_time_years": 25,
            "population_size": 20,
            "selection_coefficient": 0.0,
            "ploidy": 2,
            "seed": 1,
            "fitness_class": "EDUCATIONAL_TOY",
        },
        None,
    )
    assert neutral["workspace_id"] == restored["workspace_id"]
    assert neutral["workspace_id"] != second["workspace_id"]


def test_horizon_uses_floor_generations(tmp_path):
    store = WorkspaceStore(path=tmp_path / "state.json")
    workspace = store.create_workspace("years")
    result = store.simulate(
        {
            "workspace_id": workspace["workspace_id"],
            "horizon_years": 99,
            "generation_time_years": 25,
            "population_size": 8,
            "ploidy": 2,
            "seed": 1,
            "fitness_class": "EDUCATIONAL_TOY",
        },
        None,
    )
    assert result["generations_executed"] == 3
    assert result["simulated_years"] == 75
