"""Time one diploid replicate bundle and write a checksum receipt."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from services.runtime.population.wright_fisher import (  # noqa: E402
    FitnessClass,
    WrightFisherRequest,
    run_wright_fisher,
)


def main() -> None:
    started = time.perf_counter()
    runs = []
    for seed in (1, 2):
        runs.append(
            run_wright_fisher(
                WrightFisherRequest(
                    initial_frequency=0.5,
                    population_size=60,
                    generations=80,
                    generation_time_years=25,
                    selection_coefficient=0.2,
                    ploidy=2,
                    seed=seed,
                    fitness_class=FitnessClass.EDUCATIONAL_TOY,
                    environment={"temperature_c": 12},
                )
            )
        )
    elapsed = time.perf_counter() - started
    receipt = {
        "engine_version": runs[0]["engine_version"],
        "seconds": round(elapsed, 4),
        "replicates": [
            {"seed": item["seed"], "result_sha256": item["result_sha256"], "end_frequency": item["frames"][-1]["allele_frequency"]}
            for item in runs
        ],
        "playback_seconds": 60,
        "note": "Playback length is a clock over stored frames. It is not this compute time.",
    }
    out = ROOT / "artifacts" / "v11" / "benchmark.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
