# Signature Experiment: The Reference Integrity Incident

## Narrative Walkthrough (3 Minutes)

### Phase 1: The Integrity Failure (00:00 - 00:45)
1. **User Action**: Loads `synthetic_incident_chr22.vcf` claiming GRCh38 assembly against reference `ref_synthetic_chr22.fasta`.
2. **Baseline Behavior**: The baseline agent (`harness-v1`) has `require_reference_allele_check: false`. It parses the file and marks the task complete despite a severe reference mismatch at position 105002 (REF allele declared as 'G' while GRCh38 has 'T').
3. **Independent Detection**: The deterministic validator detects the mismatch and flags it as a high-severity integrity failure.

### Phase 2: Diagnosis & Harness Mutation (00:45 - 01:30)
1. **Diagnosis**: Agent diagnoses a harness policy gap: reference verification was skipped in `validation_policy`.
2. **Mutation Proposal**: The proposer branches a new candidate harness `harness-v2-candidate` enabling `require_reference_allele_check: true`.
3. **Interactive 3D Graph**: Evolution view dynamically updates showing the branched candidate node.

### Phase 3: Independent Evaluation & Gating (01:30 - 02:15)
1. **Isolated Replay**: Evaluator executes parent and candidate in separate sandboxes.
2. **Negative Control**: Valid fixture `valid_snvs.vcf` is tested. The candidate passes 100% without false-positive rejections.
3. **Transfer Test**: Candidate successfully catches an unseen mismatch on `unseen_mismatch.vcf`.
4. **Promotion**: Candidate is promoted to active harness. An immutable `EvidenceReceipt` is persisted to MongoDB.

### Phase 4: Chaos Recovery & Spoken Evidence Briefing (02:15 - 03:00)
1. **Chaos Demonstration**: Worker process is terminated (`make demo-kill-worker`).
2. **Durable Resume**: Restarted worker (`make worker`) picks up the expired lease from MongoDB and continues without data loss.
3. **Evidence Briefing**: User clicks **Explain Evidence** to receive a verified, captioned ElevenLabs briefing.
