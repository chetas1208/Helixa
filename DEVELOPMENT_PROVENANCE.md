# Development Provenance & Originality Statement

- **Project**: DIAMOND Genome V4
- **Date**: October 11, 2026
- **Architecture**: Proof-Carrying Harness Evolution (PCHE) for Computational Genomics.
- **Originality & Attribution**: All orchestrator, harness state machine, evaluation gatekeeper, MongoDB lineage, 3D DNA rendering, and deterministic bioinformatics integrations in this repository were designed and implemented specifically for this project.
- **Third-Party Code**: No source trees or codebases from previous hackathon repositories have been copied or reused. Standard libraries (pysam, htslib/bcftools, Three.js, FastAPI, PyMongo) are consumed as external package dependencies under their respective licenses.
- **Research Use Only**: This software is strictly for research reproducibility and computational integrity verification. It is not intended for medical diagnosis, clinical treatment, pathogenicity prediction, or sequence design.

## V8 integration provenance (2026-10-11)

The V8 campaign added adapters inside this repository. It did not replace the Milestone 01–02, V6, or V7 code with an upstream checkout.

- EBI VCF Validator 0.10.2 binaries are executed. That project was not written here.
- GEPA 0.1.4 is installed and not used as a live optimizer.
- Biomni and Meta-Harness were not imported. Local deterministic code performs VCF metadata inspection and harness-policy search.
- Clinical consequence labels are not produced.

## HELIXA publication provenance (2026-10-11)

The public product name is HELIXA — The Living Genome Studio. This is the same repository. It is not a new application that replaced the scientific code.

- Commits through `17739fa` are the pre-publication history: the V4 MVP and Milestone 01 durability work, already on `main` before this publication commit.
- The publication commit adds the studio that was in the working tree on 2026-10-11: the four-tab web app, anatomy stage, genome-edit grammar, population playback, and research-evidence adapters. That work is same-day project work in this tree, not an imported product.
- `.research/upstream/` on the development machine holds inspection checkouts (including GEPA, the EBI validator, and other upstream repositories). Those directories are gitignored and are not in the published tree. They were not copied into `services/` or `apps/web/`.
- EBI validator binaries, when present locally, stay gitignored. Checksums and the license row above record the pin.
- Generated `artifacts/`, local `.env`, and `.cursor/` are not published. A local API log under `artifacts/` contained a MongoDB URI with userinfo and was left untracked.
