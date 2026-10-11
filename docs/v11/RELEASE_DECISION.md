# V11 release decision

**CONDITIONAL GO**

The diploid additive model, the neutral-versus-selection checks, the workspace switch invariant, and the Studio stale-frame clear are in the tree and the V11 test target passed.

Blockers that keep this from GO:

- Reference is the synthetic chr22 fixture, not a verified GRCh38 region.
- Persistence is a JSON file, not Atlas, and there is no worker lease around the simulation.
- 2,000,000 years at a 25-year generation is still rejected at 80,000 generations. The 60-second control is a clock over stored frames. A full minute was not watched in the browser.
- Raindrop, ElevenLabs, and a research-model call were not exercised.
- SLiM, tskit, and msprime are not installed.
- The older regression suite was not re-run.
