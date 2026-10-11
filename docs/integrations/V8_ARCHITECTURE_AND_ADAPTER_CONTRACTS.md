# V8 architecture and adapter contracts

DIAMOND remains the supervisor. External projects are either a pinned executable or a design reference.

```text
synthetic VCF + FASTA
        |
        +-- baseline harness (REF check off) --> miss recorded
        |
        +-- EbiVcfValidator + DeterministicGenomicsValidator
        |         PairedScientificEvaluator.adjudicate
        |
        +-- MetaHarnessSearchAdapter / GepaProposerAdapter
        |         both emit HarnessSpec patches
        |         PolicyEnvelope rejects execute_shell
        |
        +-- IndependentEvaluator (held-out fixtures stay here)
        |
        +-- one promotion pointer write
        |
        +-- EvidenceReceiptV8 digest
```

Scheduling choice: one proposer policy. The deterministic search and the reflective text proposer both run under `PolicyEnvelope` and `IndependentEvaluator`. GEPA's `optimize()` is not a second supervisor. Meta-Harness is not imported.

Contracts in `services/integrations/contracts.py`:

- `ScientificToolManifest`
- `ToolInvocationRequest` / `ToolInvocationResult`
- `ScientificCheckResult`
- `GenomicIncident`
- `HarnessCandidatePatch`
- `EvaluationRun`
- `SafetyGateOutcome`
- `EvidenceReceiptV8`
- `ExternalIntegrationHealth`

Adjudication values: `AGREE_PASS`, `AGREE_FAIL`, `DISAGREE`, `INCONCLUSIVE`, `TOOL_ERROR`.

A missing FASTA forces `INCONCLUSIVE` even when syntax checks agree. `build_identity_proven` is not set true by allele agreement.

EBI flags confirmed on v0.10.2:

- `vcf_validator -i -l {error,warning,stop} -r summary,text -o`
- `vcf_assembly_checker -i -f -r summary,text -o`
