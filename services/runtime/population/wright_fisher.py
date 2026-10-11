"""Seeded haploid Wright–Fisher step for one biallelic locus.

This is a population model. It does not predict an organism's body, health, or survival
outside the declared fitness numbers.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class FitnessClass(str, Enum):
    EMPIRICAL_VALIDATED = "EMPIRICAL_VALIDATED"
    USER_ASSUMED = "USER_ASSUMED"
    EDUCATIONAL_TOY = "EDUCATIONAL_TOY"
    UNSUPPORTED = "UNSUPPORTED"


class SimulationError(ValueError):
    """The request is outside the declared model or the compute budget."""


class WrightFisherRequest(BaseModel):
    initial_frequency: float = Field(ge=0.0, le=1.0)
    population_size: int = Field(ge=0, le=2000)
    generations: int = Field(ge=0, le=2000)
    generation_time_years: float = Field(gt=0.0, le=1_000_000.0)
    mutation_forward: float = Field(default=0.0, ge=0.0, le=1.0)
    mutation_reverse: float = Field(default=0.0, ge=0.0, le=1.0)
    migration_rate: float = Field(default=0.0, ge=0.0, le=1.0)
    migrant_frequency: float = Field(default=0.0, ge=0.0, le=1.0)
    selection_coefficient: float = 0.0
    fitness_class: FitnessClass = FitnessClass.EDUCATIONAL_TOY
    seed: int = 1
    ploidy: int = 1
    max_frames: int = Field(default=240, ge=2, le=600)
    # Recorded for the manifest. Not applied unless a fitness class says so.
    environment: dict[str, Any] = Field(default_factory=dict)

    @field_validator("ploidy")
    @classmethod
    def _ploidy(cls, value: int) -> int:
        if value not in (1, 2):
            raise ValueError("ploidy must be 1 (haploid) or 2 (diploid additive fitness)")
        return value

    @field_validator("selection_coefficient")
    @classmethod
    def _selection(cls, value: float) -> float:
        if not math.isfinite(value) or value < -1.0 or value > 10.0:
            raise ValueError("selection_coefficient must be finite and in [-1, 10]")
        return value


def selection_frequency(frequency: float, fitness_focal: float, fitness_other: float) -> float:
    if fitness_focal < 0 or fitness_other < 0:
        raise SimulationError("fitness must be nonnegative")
    mean = frequency * fitness_focal + (1.0 - frequency) * fitness_other
    if mean <= 0:
        raise SimulationError("mean fitness is zero; the generation is undefined")
    return (frequency * fitness_focal) / mean


def mutation_frequency(frequency: float, forward: float, reverse: float) -> float:
    return frequency * (1.0 - forward) + (1.0 - frequency) * reverse


def migration_frequency(frequency: float, rate: float, migrant: float) -> float:
    return (1.0 - rate) * frequency + rate * migrant


def diploid_selection_frequency(
    frequency: float,
    fitness_aa: float,
    fitness_het: float,
    fitness_aa_focal: float,
) -> float:
    """Deterministic diploid selection. Focal allele is A. Operator is not drift."""
    if min(fitness_aa, fitness_het, fitness_aa_focal) < 0:
        raise SimulationError("fitness must be nonnegative")
    other = 1.0 - frequency
    mean = (
        frequency * frequency * fitness_aa_focal
        + 2.0 * frequency * other * fitness_het
        + other * other * fitness_aa
    )
    if mean <= 0:
        raise SimulationError("mean fitness is zero; the generation is undefined")
    return (frequency * frequency * fitness_aa_focal + frequency * other * fitness_het) / mean


def additive_diploid_fitness(selection_coefficient: float) -> tuple[float, float, float]:
    """w_aa=1, w_Aa=1+s/2, w_AA=1+s. s is declared, not inferred from climate."""
    focal = 1.0 + selection_coefficient
    if focal < 0:
        raise SimulationError("homozygote fitness would be negative")
    heterozygote = 1.0 + selection_coefficient / 2.0
    if heterozygote < 0:
        raise SimulationError("heterozygote fitness would be negative")
    return 1.0, heterozygote, focal


def binomial(rng: random.Random, trials: int, probability: float) -> int:
    """Exact Binomial(trials, probability) via Bernoulli draws. trials is capped by the request."""
    if trials < 0:
        raise SimulationError("population size cannot be negative")
    if probability <= 0.0:
        return 0
    if probability >= 1.0:
        return trials
    return sum(1 for _ in range(trials) if rng.random() < probability)


def _fitness_pair(request: WrightFisherRequest) -> tuple[float, float, str]:
    """Return (fitness of the focal allele, fitness of the other allele, note)."""
    kind = request.fitness_class
    if kind == FitnessClass.UNSUPPORTED:
        if request.selection_coefficient != 0.0:
            raise SimulationError(
                "UNSUPPORTED fitness map cannot apply a selection coefficient. "
                "Choose USER_ASSUMED or EDUCATIONAL_TOY, or set selection_coefficient to 0 for neutral drift."
            )
        return 1.0, 1.0, "neutral drift only; no environment-to-fitness map is applied"
    if kind == FitnessClass.EMPIRICAL_VALIDATED:
        raise SimulationError(
            "EMPIRICAL_VALIDATED has no approved coefficient for this locus. "
            "Refusing to invent one. Use USER_ASSUMED with an explicit coefficient."
        )
    # EDUCATIONAL_TOY and USER_ASSUMED both use the explicit coefficient.
    # Environment fields are not converted into this number.
    other = 1.0
    focal = 1.0 + request.selection_coefficient
    if focal < 0:
        raise SimulationError("focal fitness would be negative")
    note = (
        "educational toy coefficient, not a measured fitness"
        if kind == FitnessClass.EDUCATIONAL_TOY
        else "user-assumed coefficient, not an empirical measurement"
    )
    return focal, other, note


def _frame_indexes(generations: int, max_frames: int) -> list[int]:
    if generations <= 0:
        return [0]
    if generations + 1 <= max_frames:
        return list(range(generations + 1))
    last = generations
    step = last / (max_frames - 1)
    indexes = sorted({0, last, *(int(round(i * step)) for i in range(1, max_frames - 1))})
    return indexes


def run_wright_fisher(request: WrightFisherRequest) -> dict[str, Any]:
    focal, other, fitness_note = _fitness_pair(request)
    diploid_weights: tuple[float, float, float] | None = None
    if request.ploidy == 2:
        diploid_weights = additive_diploid_fitness(request.selection_coefficient)
        fitness_note = (
            f"{fitness_note}; additive diploid weights w_aa={diploid_weights[0]}, "
            f"w_Aa={diploid_weights[1]}, w_AA={diploid_weights[2]}"
        )
    copies = request.population_size * request.ploidy
    rng = random.Random(request.seed)
    frequency = request.initial_frequency
    extinct = request.population_size == 0
    wanted = set(_frame_indexes(request.generations, request.max_frames))
    frames: list[dict[str, Any]] = []

    def record(generation: int, freq: float, extinct_now: bool) -> None:
        frames.append(
            {
                "generation": generation,
                "simulated_years": generation * request.generation_time_years,
                "allele_frequency": freq,
                "population_size": 0 if extinct_now else request.population_size,
                "extinct": extinct_now,
                "interpolated": False,
            }
        )

    record(0, frequency, extinct)
    for generation in range(1, request.generations + 1):
        if extinct or copies == 0:
            frequency = 0.0
            extinct = True
        else:
            if diploid_weights is None:
                selected = selection_frequency(frequency, focal, other)
            else:
                selected = diploid_selection_frequency(frequency, *diploid_weights)
            mutated = mutation_frequency(selected, request.mutation_forward, request.mutation_reverse)
            mixed = migration_frequency(mutated, request.migration_rate, request.migrant_frequency)
            mixed = min(1.0, max(0.0, mixed))
            drawn = binomial(rng, copies, mixed)
            frequency = drawn / copies
        if generation in wanted:
            record(generation, frequency, extinct)

    if request.ploidy == 1:
        limitations = [
            "One haploid biallelic locus. Not a whole genome and not a human body.",
            "Environment values are stored and marked NOT_MODELED. They do not change allele counts.",
            "Extinction means the simulated population size is zero under these assumptions.",
            "Stored frames are computed generations. Gaps between frames are not extra observations.",
        ]
        engine_version = "v10-haploid-1"
    else:
        limitations = [
            "One diploid biallelic locus with additive fitness. Not a whole genome and not a human body.",
            "Operator order is selection, then mutation, then migration, then binomial sampling of 2N gene copies.",
            "Environment values are stored and marked NOT_MODELED. They do not change allele counts.",
            "Extinction means the simulated population size is zero under these assumptions.",
            "Stored frames are computed generations. Gaps between frames are not extra observations.",
        ]
        engine_version = "v11-diploid-1"
    payload = {
        "engine": "wright_fisher",
        "engine_version": engine_version,
        "fidelity": "TIER_A_EXACT_GENERATIONS",
        "fitness_class": request.fitness_class.value,
        "fitness_note": fitness_note,
        "fitness_focal": focal,
        "fitness_other": other,
        "environment_effects": {key: "NOT_MODELED" for key in request.environment},
        "seed": request.seed,
        "generations_executed": request.generations,
        "generation_time_years": request.generation_time_years,
        "simulated_years": request.generations * request.generation_time_years,
        "population_size": request.population_size,
        "ploidy": request.ploidy,
        "recombination": "NOT_MODELED",
        "limitations": limitations,
        "frames": frames,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    payload["result_sha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return payload
