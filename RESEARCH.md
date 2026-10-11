# Scientific & Agent Systems Research Grounding

DIAMOND Genome's Proof-Carrying Harness Evolution (PCHE) architecture synthesizes foundations from recent autonomous agent research, computational genomics, and formal verification:

## 1. Darwin Gödel Machine (DGM)
- **Reference**: Zhang et al., *Darwin Gödel Machine*, [arXiv:2505.22954](https://arxiv.org/abs/2505.22954).
- **Core Insight**: DGM explores open-ended self-improving agents that generate, evaluate, and retain variants of their own architecture while maintaining formal verification guarantees.
- **DIAMOND Implementation**: PCHE applies this principle to the *harness layer* rather than model weights. Agent variants must satisfy an immutable policy envelope and survive independent regression and holdout tests before promotion.

## 2. GEPA (Reflective Adaptation)
- **Reference**: Agrawal et al., *GEPA: Execution-Feedback Driven Agent Adaptation*, [arXiv:2507.19457](https://arxiv.org/abs/2507.19457).
- **Core Insight**: Adapting agent configurations based on deterministic failure traces and execution telemetry prevents repeating blind failures.
- **DIAMOND Implementation**: When deterministic bioinformatic validators detect a reference mismatch or missing metadata, the diagnosis engine associates the failure with a missing harness policy constraint.

## 3. Meta-Harness Optimization
- **Reference**: *Meta-Harness: Bounded Policy Evolution for Agent Safety*, [arXiv:2603.28052](https://arxiv.org/abs/2603.28052).
- **Core Insight**: True self-improvement occurs when the scaffolding (context, tool allowances, validation gates) is tuned deterministically while holding the evaluation oracle strictly isolated.
- **DIAMOND Implementation**: Strict separation between the editable `HarnessSpec` and the immutable `PolicyEnvelope` prevents evaluator tampering and capability overreach.

## 4. Genome in a Bottle (GIAB) & Deterministic Bioinformatics
- **Reference**: Zook et al., *NIST Genome in a Bottle Consortium*, [NIST GIAB](https://www.nist.gov/programs-projects/genome-bottle).
- **Core Insight**: Reference genome integrity, allele normalization, and contig consistency are non-negotiable prerequisites for valid genomic conclusions.
- **DIAMOND Implementation**: Uses deterministic `pysam` and `bcftools` to inspect exact nucleotide coordinates and sequence matches against declared reference FASTA assets.

## 5. V8 external instruments (not authored here)

These systems are cited because V8 binds to them or refuses them. DIAMOND did not create them.

- Biomni, Stanford Snap: https://github.com/snap-stanford/Biomni — inspected at `400c1f366b96a35ca253e13c9b06c5076af41d65`. The agent is not executed.
- Meta-Harness, Stanford IRIS: https://github.com/stanford-iris-lab/meta-harness — inspected at `8123ccabe2b19fa1123090b2e5f1bacc20963ce8`. Not imported. Local search provenance is `DETERMINISTIC`.
- GEPA: https://github.com/gepa-ai/gepa — package 0.1.4 from `462e437a09be67d2acb59564cc0ea59132f5777c`. `optimize()` was not run.
- EBI VCF Validator: https://github.com/EBIvariation/vcf-validator — release binaries 0.10.2 are the independent syntax and assembly checker.
- GATK ValidateVariants was not integrated. The EBI assembly checker plus pysam cover the REF-agreement check used in the synthetic experiment.

