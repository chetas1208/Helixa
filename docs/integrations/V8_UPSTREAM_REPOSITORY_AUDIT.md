# V8 upstream repository audit

Date: 2026-10-11. Inspection clones live under `.research/upstream/`, which is gitignored. SHAs below are `git rev-parse HEAD` after a shallow clone. No upstream install script was executed.

| Repository | Retrieved commit | License observed | Class | What was used |
|---|---|---|---|---|
| snap-stanford/Biomni | `400c1f366b96a35ca253e13c9b06c5076af41d65` | Apache-2.0 (`LICENSE`) | B | Tool-description shape was read. `biomni` is not imported. The agent is not started. README warns that generated code runs with broad privileges. |
| stanford-iris-lab/meta-harness | `8123ccabe2b19fa1123090b2e5f1bacc20963ce8` | MIT, Copyright (c) 2026 Yoonho Lee | B | `ONBOARDING.md` and `reference_examples/` show Claude proposer wrappers. No module is imported. |
| gepa-ai/gepa | `462e437a09be67d2acb59564cc0ea59132f5777c` | MIT, Copyright (c) 2025 Lakshya A Agrawal | A, unused as a live optimizer | Package `gepa==0.1.4` installed with `--no-deps` from that checkout. `optimize()` is not called. |
| EBIvariation/vcf-validator | source `de03ec2b9c180ad6be5d0c1274cf4529a6303457`; binaries release `v0.10.2` | Apache-2.0 | A | `vcf_validator_linux` and `vcf_assembly_checker_linux` run on synthetic fixtures. SHA-256 is checked before execution. |
| bioagent-bench/bioagent-bench | `6d098b602b8a8fdc33a9d25e410a502be7ed9ce0` | CC BY 4.0 on the project LICENSE. README states third-party datasets keep their own terms. | C | Tree inspected. No dataset imported. No task runner started. |
| vin-bio/bioinformatics-agent | `954e6e68c424a6ba16a1e994f6e550cba5138fd0` | MIT, Copyright (c) 2024 Ashwin Gopinath | C | Tree inspected. Not imported. |
| nf-core/sarek | `87fd1b416d783b0fc2982c363a6d5458e88726a2` | MIT, Copyright (c) The nf-core/sarek team | C | Tree inspected. Nextflow was not installed. |
| raindrop-ai/workshop | `a6b82d71596cf7e8974e5efae63f9e15260d76ef` | MIT, Copyright (c) 2026 Invisible Tools, Inc. (dba Raindrop) | C | Tree inspected. No Workshop process was started. The existing adapter stays `NOT_CONFIGURED` without a write key. |

Biomni's Apache-2.0 license does not grant rights to every database or model its tools reference. Those resources were not downloaded.

## Decision table

| Component | API actually used | DIAMOND destination | Runtime cost | Permission | Proof | Fallback |
|---|---|---|---|---|---|---|
| EBI `vcf_validator` / `vcf_assembly_checker` 0.10.2 | subprocess argv verified from `--help` | `services/integrations/ebi_vcf/validator.py` | local binary, 30s timeout, no network at runtime | read-only inputs, scratch reports | `services/tests/test_ebi_disagreement.py` | checksum failure returns `ERROR`, not a pass |
| Biomni genomics tools | not called | local `BiomniToolAdapter` statistics and region count | in-process read of the VCF | read-only path, shell tokens rejected | `services/tests/test_biomni_security.py` | unknown tool or consequence lookup returns `ERROR` |
| Meta-Harness search | not called | `MetaHarnessSearchAdapter.generate_candidates` | in-process | policy envelope | `services/tests/test_optimizer_gate.py` | provenance `DETERMINISTIC` |
| GEPA `optimize` | imported, not called | `gepa_package_status()` | none | no model calls | status `INSTALLED_UNCONFIGURED` | deterministic proposer |
