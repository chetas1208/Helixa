# V10 science model

Engine: haploid Wright–Fisher, one biallelic locus, `engine_version` `v10-haploid-1`.

Order each generation, when population size is positive:

1. `p_selected = (p * w_focal) / (p * w_focal + (1-p) * w_other)`
2. `p_mutated = p_selected * (1-mu) + (1-p_selected) * nu`
3. `p_mixed = (1-m) * p_mutated + m * p_migrant`
4. `X ~ Binomial(N, p_mixed)` via N Bernoulli draws. `p_next = X/N`.

`w_other` is 1. `w_focal` is `1 + s` only for `EDUCATIONAL_TOY` and `USER_ASSUMED`. `s` is the request field, never a function of temperature.

`EMPIRICAL_VALIDATED` raises. There is no approved coefficient for this synthetic locus.

`UNSUPPORTED` with `s != 0` raises. With `s = 0` the run is neutral drift.

`simulated_years = generations * generation_time_years`.

Population size 0 is extinction in the model. Recombination is not modeled. Diploid dominance is rejected.

Frames are computed generations. A 60-second player may sit between them; that clock position is labeled interpolated and is not an extra generation.

2,000,000 years at 25 years per generation is 80,000 generations. The API budget is 2,000 generations. The extra generations are not skipped and not invented.
