"""Environment catalog. Local examples only. NASA POWER is not called."""

from __future__ import annotations

from typing import Any

# Parameters that the Wright–Fisher engine actually reads.
MODELED_KEYS = frozenset(
    {
        "population_size",
        "generation_time_years",
        "horizon_years",
        "selection_coefficient",
        "mutation_forward",
        "migration_rate",
        "migrant_frequency",
        "initial_frequency",
        "seed",
    }
)

PRESETS: list[dict[str, Any]] = [
    {
        "id": "temperate-forest-example",
        "label": "Temperate forest (local example)",
        "scope": "FICTIONAL_EDUCATIONAL",
        "source": "HELIXA local catalog. Not a NASA POWER response and not a paleoclimate reconstruction.",
        "values": {"temperature_c": 12.0, "precipitation_mm_year": 900.0, "altitude_m": 180.0},
    },
    {
        "id": "arid-example",
        "label": "Arid basin (local example)",
        "scope": "FICTIONAL_EDUCATIONAL",
        "source": "HELIXA local catalog. Assumed numbers, not a station record.",
        "values": {"temperature_c": 28.0, "precipitation_mm_year": 120.0, "altitude_m": 450.0},
    },
    {
        "id": "cold-alpine-example",
        "label": "Cold alpine (local example)",
        "scope": "FICTIONAL_EDUCATIONAL",
        "source": "HELIXA local catalog. Assumed numbers, not a station record.",
        "values": {"temperature_c": -2.0, "precipitation_mm_year": 700.0, "altitude_m": 2100.0},
    },
]


def parameter_specs() -> list[dict[str, Any]]:
    inactive = "NOT_MODELED"
    modeled = "WRIGHT_FISHER_INPUT"
    return [
        _spec("temperature_c", "Climate", "Mean temperature", "°C", -20, 45, 12, inactive),
        _spec("precipitation_mm_year", "Climate", "Annual precipitation", "mm/year", 0, 5000, 900, inactive),
        _spec("altitude_m", "Habitat", "Elevation", "m", 0, 6000, 180, inactive),
        _spec("population_size", "Demography", "Census population size", "individuals", 0, 2000, 80, modeled),
        _spec("generation_time_years", "Process", "Generation time", "years", 1, 100000, 25, modeled),
        _spec("horizon_years", "Process", "Simulated horizon", "years", 0, 2_000_000, 2000, modeled),
        _spec("selection_coefficient", "Process", "Selection coefficient s", "dimensionless", -1, 10, 0, modeled),
        _spec("mutation_forward", "Process", "Forward mutation rate", "per generation", 0, 1, 0, modeled),
        _spec("migration_rate", "Process", "Migration rate", "fraction", 0, 1, 0, modeled),
        _spec("initial_frequency", "Process", "Starting frequency of the edited allele", "fraction", 0, 1, 0.5, modeled),
        _spec("recombination_rate", "Process", "Recombination rate", "per generation", 0, 1, 0, inactive),
    ]


def _spec(
    key: str,
    category: str,
    label: str,
    unit: str,
    minimum: float,
    maximum: float,
    default: float,
    effect: str,
) -> dict[str, Any]:
    return {
        "id": key,
        "category": category,
        "label": label,
        "unit": unit,
        "default": default,
        "minimum": minimum,
        "maximum": maximum,
        "model_effect": effect,
        "effect_status": "NOT_MODELED" if effect == "NOT_MODELED" else "ACTIVE_MODELED",
        "observed_or_assumed": "ASSUMED",
        "scientific_source": "User or HELIXA educational catalog. Not a live climatology feed.",
        "help_text": (
            "This number is an input to the haploid Wright–Fisher step."
            if effect != "NOT_MODELED"
            else "Shown for context. It does not change allele counts."
        ),
    }
