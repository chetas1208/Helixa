# V11 scientific model card

## Domain

One biallelic locus. Research illustration. Not a human body, not a clinical variant, not a forecast of the next two million years.

## Haploid (ploidy 1), unchanged from V10

Gene copies = N. Fitness of the focal allele is `1+s`, the other allele is `1`, only when the fitness class is `EDUCATIONAL_TOY` or `USER_ASSUMED`.

## Diploid (ploidy 2)

Gene copies = `2N`. Additive map, not estimated from climate:

- `w_aa = 1`
- `w_Aa = 1 + s/2`
- `w_AA = 1 + s`

Deterministic selection, with `q = 1-p`:

- `w_bar = p^2 w_AA + 2 p q w_Aa + q^2 w_aa`
- `p_selected = (p^2 w_AA + p q w_Aa) / w_bar` when `w_bar > 0`

`w_bar <= 0` raises. It does not divide by zero.

## Operator order

1. Selection
2. Mutation `p*(1-u) + (1-p)*v`
3. Migration `(1-m)*p + m*p_source`
4. Drift `K ~ Binomial(copies, p)` and `p_next = K/copies`

## What is not in the equations

Temperature, precipitation, altitude, and recombination are `NOT_MODELED`. Changing them does not change the result hash.

`EMPIRICAL_VALIDATED` is refused. No coefficient is approved for this synthetic locus.

## Time

`generations = floor(horizon_years / generation_time_years)`. Years shown on a frame are `generation * generation_time_years`. A 60-second playback is a clock over stored frames. Compute time is separate and is recorded by `make benchmark-v11`.

## Repeatability

Same seed, ploidy, and parameters produce the same `result_sha256` in this Python process. Two seeds are different draws.
