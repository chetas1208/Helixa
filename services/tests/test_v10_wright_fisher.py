"""Wright–Fisher invariants. No network and no Mongo."""

import random

import pytest

from services.runtime.population.wright_fisher import (
    FitnessClass,
    SimulationError,
    WrightFisherRequest,
    migration_frequency,
    mutation_frequency,
    run_wright_fisher,
    selection_frequency,
)


def test_selection_matches_the_published_ratio():
    assert selection_frequency(0.25, 2.0, 1.0) == pytest.approx(0.4)


def test_mutation_and_migration_stay_inside_the_unit_interval():
    mutated = mutation_frequency(0.2, 0.1, 0.05)
    assert mutated == pytest.approx(0.2 * 0.9 + 0.8 * 0.05)
    mixed = migration_frequency(mutated, 0.25, 0.8)
    assert 0.0 <= mixed <= 1.0


def test_zero_population_is_extinction():
    result = run_wright_fisher(
        WrightFisherRequest(
            initial_frequency=0.4,
            population_size=0,
            generations=3,
            generation_time_years=25,
            fitness_class=FitnessClass.EDUCATIONAL_TOY,
        )
    )
    assert all(frame["extinct"] for frame in result["frames"])
    assert result["frames"][-1]["population_size"] == 0


def test_negative_fitness_is_rejected():
    with pytest.raises(SimulationError):
        selection_frequency(0.5, -0.2, 1.0)


def test_neutral_without_mutation_or_drift_holds_frequency():
    result = run_wright_fisher(
        WrightFisherRequest(
            initial_frequency=0.3,
            population_size=0,
            generations=0,
            generation_time_years=25,
            fitness_class=FitnessClass.UNSUPPORTED,
        )
    )
    assert result["frames"][0]["allele_frequency"] == pytest.approx(0.3)


def test_same_seed_reproduces_and_another_seed_can_differ():
    common = dict(
        initial_frequency=0.5,
        population_size=40,
        generations=30,
        generation_time_years=25,
        selection_coefficient=0.0,
        fitness_class=FitnessClass.EDUCATIONAL_TOY,
    )
    first = run_wright_fisher(WrightFisherRequest(seed=7, **common))
    again = run_wright_fisher(WrightFisherRequest(seed=7, **common))
    other = run_wright_fisher(WrightFisherRequest(seed=8, **common))
    assert first["result_sha256"] == again["result_sha256"]
    assert first["frames"][-1]["allele_frequency"] != other["frames"][-1]["allele_frequency"]


def test_environment_temperature_does_not_change_counts():
    common = dict(
        initial_frequency=0.5,
        population_size=50,
        generations=20,
        generation_time_years=25,
        seed=3,
        selection_coefficient=0.2,
        fitness_class=FitnessClass.USER_ASSUMED,
    )
    cold = run_wright_fisher(WrightFisherRequest(environment={"temperature_c": -5}, **common))
    hot = run_wright_fisher(WrightFisherRequest(environment={"temperature_c": 40}, **common))
    assert cold["result_sha256"] == hot["result_sha256"]
    assert cold["environment_effects"]["temperature_c"] == "NOT_MODELED"


def test_unsupported_map_refuses_a_secret_coefficient():
    with pytest.raises(SimulationError, match="UNSUPPORTED"):
        run_wright_fisher(
            WrightFisherRequest(
                initial_frequency=0.5,
                population_size=20,
                generations=5,
                generation_time_years=25,
                selection_coefficient=0.4,
                fitness_class=FitnessClass.UNSUPPORTED,
            )
        )


def test_years_are_generations_times_generation_time():
    result = run_wright_fisher(
        WrightFisherRequest(
            initial_frequency=0.2,
            population_size=10,
            generations=8,
            generation_time_years=25,
            seed=1,
        )
    )
    assert result["simulated_years"] == 200
    assert result["frames"][-1]["simulated_years"] == 200
    assert all(frame["interpolated"] is False for frame in result["frames"])


def test_two_million_years_at_a_human_generation_is_over_budget(tmp_path):
    from services.runtime.genome_workspace.store import MAX_GENERATIONS, WorkspaceStore
    from services.runtime.population.wright_fisher import SimulationError

    generations = int(2_000_000 / 25)
    assert generations > MAX_GENERATIONS
    local = WorkspaceStore(path=tmp_path / "state.json")
    created = local.create_workspace("budget")
    with pytest.raises(SimulationError, match="not skipped"):
        local.simulate(
            {
                "workspace_id": created["workspace_id"],
                "horizon_years": 2_000_000,
                "generation_time_years": 25,
                "population_size": 20,
                "fitness_class": "EDUCATIONAL_TOY",
            },
            None,
        )


def test_frames_include_the_last_generation():
    result = run_wright_fisher(
        WrightFisherRequest(
            initial_frequency=0.5,
            population_size=15,
            generations=500,
            generation_time_years=10,
            max_frames=12,
            seed=2,
        )
    )
    assert result["frames"][0]["generation"] == 0
    assert result["frames"][-1]["generation"] == 500
    assert len(result["frames"]) <= 12


def test_frequencies_stay_in_range():
    rng = random.Random(0)
    for _ in range(20):
        result = run_wright_fisher(
            WrightFisherRequest(
                initial_frequency=rng.random(),
                population_size=rng.randint(1, 30),
                generations=rng.randint(1, 15),
                generation_time_years=25,
                mutation_forward=0.01,
                mutation_reverse=0.01,
                migration_rate=0.05,
                migrant_frequency=0.4,
                seed=rng.randint(1, 9999),
            )
        )
        for frame in result["frames"]:
            assert 0.0 <= frame["allele_frequency"] <= 1.0
            assert frame["population_size"] >= 0
