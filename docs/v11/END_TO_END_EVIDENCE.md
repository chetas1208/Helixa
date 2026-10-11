# V11 end-to-end evidence

Benchmark receipt: `artifacts/v11/benchmark.json`.

Diploid engine `v11-diploid-1`, two seeds, selection coefficient 0.2, N=60, 80 generations, 25 years each:

- seed 1 sha256 `cf6a89277d0777c0e8a1a2a5f590544d08fa735b7b515217386dc911bf205295` end frequency 1.0
- seed 2 sha256 `5bef000d6202eeecd717a9225a1c754f28b6caa8f3742aa5ebee79c65deabb62` end frequency 1.0

Compute time on this run was about 0.0015 seconds. Playback is still defined as 60 seconds and is not that compute time.

Earlier haploid demo hash remains `3bd52f0f56a88b0d92c328772e2b71ab98f750d262e0a4801de1b8dc4a5424e5` for the V10 settings. This pass did not re-run that script.

Browser: Studio Sandbox shows ploidy default “2 diploid” and the operator order (selection, mutation, migration, then 2N draws). Temperature is labeled not modeled. Raindrop and ElevenLabs status pills still say not configured. Mongo status on this machine is local, not Atlas.
