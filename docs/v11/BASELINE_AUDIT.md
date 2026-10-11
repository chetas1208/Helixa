# V11 baseline audit

2026-10-11. Dirty worktree kept. No reset.

V10 already had a haploid Wright–Fisher engine, a JSON workspace file, and a Studio mode with four inner tabs. `make verify-v10` had passed. Official GRCh38 is still not on disk. SLiM, tskit, msprime, NASA POWER, Atlas writes, Raindrop, and ElevenLabs were not live.

Gaps found by reading the code, not the V10 write-up alone:

- Ploidy was rejected unless it was 1.
- Switching workspaces in the Studio library left the previous simulation on screen.
- Climate parameters were labeled not modeled, but the registry did not use the V11 effect-status names.
- There was no independent numerical check of the diploid selection formula, and no one-generation drift-variance check.
- Workspace state is still a local JSON file. It is not MongoDB Atlas.

Execution mode for this pass: sequential, one session. Five subagents were not spawned.
