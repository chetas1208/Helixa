# V13 simulation assumptions

The numerical engine is unchanged from V11: haploid or additive diploid Wright–Fisher, operator order selection → mutation → migration → binomial sample.

`floor(horizon_years / generation_time_years)` is the generation count. Above 2000 generations the API returns 409 and writes no frames.

Playback duration does not recompute the trajectory. Frames stay `interpolated: false`. A clock between them is display-only.

Climate fields stay `NOT_MODELED`.
