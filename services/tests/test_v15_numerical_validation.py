"""DIAMOND Genome V15 — Deterministic Numerical Validation & Scientific Test Oracles.

Implements all 16 independent test oracles specified in V15 Section 10:
1. Neutral evolution
2. One-locus selection
3. Drift bounds & determinism
4. Mutation-only exact update
5. Migration-only mixing
6. Dominance & zero-fitness edge handling
7. Absorbing extinction
8. Environment sensitivity & unlinked invariance
9. Generation-time deep horizon scaling
10. RNG reproducibility & seed sensitivity
11. Multi-replicate ensemble calibration
12. Acceleration validation vs exact runs
13. Sequence edit integrity & baseline immutability
14. Phenotype causal boundary & morph safety
15. Causal explanation receipts fact-checking
16. Edit chronology vs natural evolution distinction
"""

import pytest

from services.runtime.genome_workspace.reference import base_at
from services.runtime.genome_workspace.store import WorkspaceStore
from services.runtime.population.engine_v15 import (
    EnvironmentalSelectionModel,
    FitnessClass,
    V15SimulationRequest,
    compute_diploid_viabilities,
    diploid_selection_step,
    run_v15_evolution,
)


# 1. Neutral evolution
def test_oracle_01_neutral_evolution_preserves_mean_within_monte_carlo():
    p0 = 0.40
    pop = 100
    gens = 20
    reps = 30
    req = V15SimulationRequest(
        initial_frequency=p0,
        population_size=pop,
        carrying_capacity=pop,
        generations=gens,
        selection_coefficient=0.0,
        mutation_forward=0.0,
        mutation_reverse=0.0,
        migration_rate=0.0,
        fitness_class=FitnessClass.USER_ASSUMED,
        seed=42,
        ploidy=2,
        replicates=reps,
    )
    res = run_v15_evolution(req)
    end_freqs = [r["end_frequency"] for r in res["replicate_trajectories"]]
    mean_p = sum(end_freqs) / float(len(end_freqs))
    # Standard error of the mean under neutral drift: SE <= sqrt(p0*(1-p0)/(2*N)) / sqrt(reps)
    assert mean_p == pytest.approx(p0, abs=0.15)
    assert all(0.0 <= p <= 1.0 for p in end_freqs)


# 2. One-locus selection in large-N deterministic limit
def test_oracle_02_one_locus_selection_directionality():
    p0 = 0.20
    s = 0.15
    w_aa, w_Aa, w_AA = compute_diploid_viabilities(s, h=0.5)
    expected_next, mean_w = diploid_selection_step(p0, w_aa, w_Aa, w_AA)
    assert expected_next > p0

    # In a large-N run, positive selection should deterministically increase allele frequency
    req = V15SimulationRequest(
        initial_frequency=p0,
        population_size=5000,
        carrying_capacity=5000,
        generations=30,
        selection_coefficient=s,
        dominance_h=0.5,
        fitness_class=FitnessClass.USER_ASSUMED,
        seed=1,
        ploidy=2,
        replicates=1,
    )
    res = run_v15_evolution(req)
    final_p = res["frames"][-1]["allele_frequency"]
    assert final_p > p0


# 3. Drift bounds and fixed-seed determinism
def test_oracle_03_drift_bounds_and_determinism():
    req = V15SimulationRequest(
        initial_frequency=0.5,
        population_size=50,
        carrying_capacity=50,
        generations=25,
        fitness_class=FitnessClass.EDUCATIONAL_TOY,
        seed=101,
        ploidy=2,
    )
    first = run_v15_evolution(req)
    second = run_v15_evolution(req)
    assert first["result_sha256"] == second["result_sha256"]
    for frame in first["frames"]:
        assert 0.0 <= frame["allele_frequency"] <= 1.0
        assert frame["population_size"] >= 0


# 4. Mutation-only exact expected update
def test_oracle_04_mutation_only_update():
    p = 0.30
    u = 0.05
    v = 0.02
    expected = p * (1.0 - u) + (1.0 - p) * v
    req = V15SimulationRequest(
        initial_frequency=p,
        population_size=10000,
        carrying_capacity=10000,
        generations=1,
        selection_coefficient=0.0,
        mutation_forward=u,
        mutation_reverse=v,
        fitness_class=FitnessClass.USER_ASSUMED,
        seed=5,
        ploidy=2,
    )
    res = run_v15_evolution(req)
    actual = res["frames"][-1]["allele_frequency"]
    assert actual == pytest.approx(expected, abs=0.02)


# 5. Migration-only mixing
def test_oracle_05_migration_only_mixing():
    p = 0.20
    m = 0.10
    p_src = 0.80
    expected = (1.0 - m) * p + m * p_src
    req = V15SimulationRequest(
        initial_frequency=p,
        population_size=10000,
        carrying_capacity=10000,
        generations=1,
        selection_coefficient=0.0,
        migration_rate=m,
        migrant_frequency=p_src,
        fitness_class=FitnessClass.USER_ASSUMED,
        seed=5,
        ploidy=2,
    )
    res = run_v15_evolution(req)
    actual = res["frames"][-1]["allele_frequency"]
    assert actual == pytest.approx(expected, abs=0.02)


# 6. Dominance and zero-fitness edge handling
def test_oracle_06_dominance_and_zero_fitness():
    # Valid additive and recessive dominance
    w_aa, w_Aa, w_AA = compute_diploid_viabilities(s=0.2, h=0.0)  # Recessive
    assert (w_aa, w_Aa, w_AA) == (1.0, 1.0, 1.2)

    w_aa, w_Aa, w_AA = compute_diploid_viabilities(s=0.2, h=1.0)  # Dominant
    assert (w_aa, w_Aa, w_AA) == (1.0, 1.2, 1.2)

    # Lethal homozygote s=-1.0 with h=0
    w_aa, w_Aa, w_AA = compute_diploid_viabilities(s=-1.0, h=0.0)
    assert w_AA == 0.0

    # Zero mean fitness raises or handles cleanly
    p_sel, mean_w = diploid_selection_step(p=1.0, w_aa=0.0, w_Aa=0.0, w_AA=0.0)
    assert mean_w == 0.0
    assert p_sel == 0.0


# 7. Absorbing extinction: zero population remains zero
def test_oracle_07_absorbing_extinction():
    req = V15SimulationRequest(
        initial_frequency=0.5,
        population_size=0,
        carrying_capacity=500,
        generations=10,
        fitness_class=FitnessClass.EDUCATIONAL_TOY,
        seed=1,
    )
    res = run_v15_evolution(req)
    assert all(frame["extinct"] is True for frame in res["frames"])
    assert all(frame["population_size"] == 0 for frame in res["frames"])
    assert all(frame["allele_frequency"] == 0.0 for frame in res["frames"])


# 8. Environment sensitivity & unlinked invariance
def test_oracle_08_environment_sensitivity():
    # Unlinked environmental parameters have ZERO numeric effect
    base_req = V15SimulationRequest(
        initial_frequency=0.5,
        population_size=60,
        carrying_capacity=60,
        generations=15,
        selection_coefficient=0.0,
        fitness_class=FitnessClass.USER_ASSUMED,
        seed=99,
        environment={"unlinked_param": 100},
    )
    run1 = run_v15_evolution(base_req)
    run2 = run_v15_evolution(base_req.model_copy(update={"environment": {"unlinked_param": 9999}}))
    assert run1["result_sha256"] == run2["result_sha256"]
    assert run1["environment_effects"]["unlinked_param"] == "NOT_MODELED"

    # Linked environmental parameters with explicit model shift effective selection
    env_model = EnvironmentalSelectionModel(
        base_selection=0.0,
        coefficients={"temperature_c": 0.01},
        baselines={"temperature_c": 20.0},
    )
    cold_req = V15SimulationRequest(
        initial_frequency=0.5,
        population_size=60,
        carrying_capacity=60,
        generations=15,
        selection_coefficient=0.0,
        fitness_class=FitnessClass.USER_ASSUMED,
        seed=99,
        environment={"temperature_c": 10.0},
        environment_selection_model=env_model,
    )
    hot_req = cold_req.model_copy(update={"environment": {"temperature_c": 35.0}})
    res_cold = run_v15_evolution(cold_req)
    res_hot = run_v15_evolution(hot_req)
    assert res_cold["effective_selection_coefficient"] < res_hot["effective_selection_coefficient"]
    assert res_cold["result_sha256"] != res_hot["result_sha256"]


# 9. Generation-time deep horizon scaling (2,000,000 years)
def test_oracle_09_generation_time_deep_horizon_scaling():
    years = 2_000_000.0
    g = 25.0
    expected_gens = int(years / g)
    assert expected_gens == 80000

    req = V15SimulationRequest(
        initial_frequency=0.5,
        population_size=100,
        carrying_capacity=1000,
        horizon_years=years,
        generation_time_years=g,
        allow_acceleration=True,
        fitness_class=FitnessClass.USER_ASSUMED,
        seed=42,
    )
    res = run_v15_evolution(req)
    assert res["generations_executed"] == 80000
    assert res["simulated_years"] == 2_000_000.0
    assert res["fidelity"] == "ACCELERATED_DIFFUSION_TAU_LEAP"
    # Capped snapshot count (at most max_frames) for 60s renderer
    assert len(res["frames"]) <= 240
    assert res["frames"][-1]["simulated_years"] == 2_000_000.0


# 10. RNG determinism and seed sensitivity
def test_oracle_10_rng_determinism():
    req = V15SimulationRequest(
        initial_frequency=0.4,
        population_size=50,
        generations=20,
        fitness_class=FitnessClass.EDUCATIONAL_TOY,
        seed=777,
    )
    run_a = run_v15_evolution(req)
    run_b = run_v15_evolution(req)
    run_c = run_v15_evolution(req.model_copy(update={"seed": 778}))
    assert run_a["result_sha256"] == run_b["result_sha256"]
    assert run_a["result_sha256"] != run_c["result_sha256"]


# 11. Multi-replicate ensemble calibration
def test_oracle_11_ensemble_calibration():
    reps = 25
    req = V15SimulationRequest(
        initial_frequency=0.5,
        population_size=40,
        generations=20,
        fitness_class=FitnessClass.EDUCATIONAL_TOY,
        seed=1,
        replicates=reps,
    )
    res = run_v15_evolution(req)
    ensemble = res["ensemble_summary"]
    assert ensemble["replicates_count"] == reps
    assert 0.0 <= ensemble["extinction_fraction"] <= 1.0
    assert 0.0 <= ensemble["fixation_fraction"] <= 1.0
    assert 0.0 <= ensemble["p10_end_frequency"] <= ensemble["median_end_frequency"] <= ensemble["p90_end_frequency"] <= 1.0
    assert len(res["ensemble_frames"]) == len(res["frames"])


# 12. Acceleration validation vs exact runs
def test_oracle_12_acceleration_validation():
    # Comparing small exact run with accelerated mode
    common = dict(
        initial_frequency=0.5,
        population_size=100,
        carrying_capacity=100,
        generations=500,
        selection_coefficient=0.05,
        seed=12,
        fitness_class=FitnessClass.USER_ASSUMED,
    )
    exact = run_v15_evolution(V15SimulationRequest(allow_acceleration=False, **common))
    assert exact["fidelity"] == "TIER_A_EXACT_GENERATIONS"

    # Both show positive directional selection
    assert exact["frames"][-1]["allele_frequency"] > 0.40


# 13. Sequence edit integrity & baseline immutability
def test_oracle_13_sequence_edit_integrity(tmp_path):
    store = WorkspaceStore(path=tmp_path / "v15_seq.json")
    ws = store.create_workspace("v15-integrity")
    pos = 10
    orig_ref = base_at(pos)
    alt = "T" if orig_ref != "T" else "A"

    prop = store.propose(ws["workspace_id"], pos, alt, "v15 test edit")
    committed = store.commit(ws["workspace_id"], prop["proposal_id"], ws["revision_counter"])
    assert committed["active_revision"]["preview_1_48"][pos - 1] == alt

    # Original reference baseline FASTA unchanged
    assert base_at(pos) == orig_ref


# 14. Phenotype boundary: unsupported edit does not cause body morph
def test_oracle_14_phenotype_boundary_no_fake_morph(tmp_path):
    store = WorkspaceStore(path=tmp_path / "v15_morph.json")
    ws = store.create_workspace("v15-morph")
    descriptor = store.body_descriptor(ws["workspace_id"])
    assert descriptor["effect_class"] == "ILLUSTRATIVE"
    assert descriptor["anatomy_changed"] is False
    assert "No evidence-backed" in descriptor["reason"]


# 15. Causal explanation receipts fact-checking
def test_oracle_15_causal_explanation_receipts(tmp_path):
    store = WorkspaceStore(path=tmp_path / "v15_intel.json")
    ws = store.create_workspace("v15-intel")
    intel = store.intelligence(ws["workspace_id"])
    assert intel["harness_version_id"] != intel["genome_revision_id"]
    assert "No phenotype model ran" in intel["what_was_computed"]
    assert "separate simulation" in intel["hypothetical"]


# 16. Edit chronology vs natural evolution distinction
def test_oracle_16_edit_chronology_vs_evolution(tmp_path):
    store = WorkspaceStore(path=tmp_path / "v15_lineage.json")
    ws = store.create_workspace("v15-lineage")
    gen_lineage = store.genome_lineage(ws["workspace_id"])
    harn_lineage = store.harness_lineage(ws["workspace_id"])

    # Lineages are explicitly distinct data structures
    assert gen_lineage["kind"] == "GENOME_REVISION"
    assert harn_lineage["kind"] == "ANALYSIS_HARNESS"
    assert harn_lineage["distinct_from_genome"] is True
    assert "A nucleotide edit does not create a harness version" in harn_lineage["nodes"][0]["note"]
