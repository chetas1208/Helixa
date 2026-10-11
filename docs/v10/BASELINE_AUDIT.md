# V10 baseline audit

Date: 2026-10-11. Branch left dirty. No reset.

Existing product that this campaign did not replace:

- FastAPI routes for health, datasets, runs, harnesses, evidence, validation, scene, voice, capabilities, investigations, seals, and V8.
- `services/runtime/evolution/` is harness search and promotion (PCHE). It was not reused as a biological simulator and was not overwritten.
- Local synthetic FASTA `fixtures/references/ref_synthetic_chr22.fasta`. Official GRCh38 is not cached here.
- Web app modes Mission, Evolution, and Proof stay in place. Studio is an added mode.
- MongoDB was already listening on 127.0.0.1:27017. Atlas, Raindrop, and ElevenLabs remain unconfigured.
- SLiM, msprime, and tskit are not installed. They were not vendored. SLiM is GPL-3.0 and is not copied into this tree.
- NumPy is not required. Drift uses exact Bernoulli draws inside the generation cap.

Execution mode: one coordinator, sequential. Five parallel coding agents were not spawned. File ownership would have collided on the web shell, and inventing a coordination transcript would be false.
