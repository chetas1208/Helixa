# V8 integration audit

Date: 2026-10-11. This file records the follow-up audit after the closest-existing-code campaign. It does not replace the earlier milestone notes.

## Commands

| Command | Exit | Result |
|---|---|---|
| `make audit` | 0 | `CONDITIONAL GO`. Dimensions 1–9 and 11 passed. Artifact: `artifacts/audit/verification_summary.json` (`AUDIT-V5-1791704702`). |
| `make verify-v8` | 0 | Eight scientific checks, ruff, 80 backend tests, 9 web tests, `tsc --noEmit`, and `demo_v8.py`. |
| `scripts/verify_v8_atlas.py` | 2 | `NOT_CONFIGURED`. Local MongoDB is not reported as Atlas. |

## Dimension 11

| Check | Result |
|---|---|
| EBI binaries available | true |
| REF-mismatch adjudication | `AGREE_FAIL` |
| Candidate ids stable across two proposals | true |
| Proposer label | `DETERMINISTIC` |
| GEPA | `INSTALLED_UNCONFIGURED` |
| `biomni` imported | false |

## Closed backlogs

- Content-addressed harness ids. Receipt digest `a665c6d9004799782e13137cb01e72233e5ff11208d10266db720cb70206e606`.
- Campaign resume from local MongoDB after the JSON checkpoint is removed. `artifacts/v8/runtime_metrics.json` records `checkpoint_backend: mongodb` and `promotion_writes: 1`.
- Raindrop value scrub for nucleotide runs, covered by `test_raindrop_privacy_sanitization` and audit dimensions 5 and 11.
- Reference trees cloned and left unused: BioAgent Bench `6d098b602b8a8fdc33a9d25e410a502be7ed9ce0` (CC BY 4.0), BioinformaticsAgent `954e6e68c424a6ba16a1e994f6e550cba5138fd0` (MIT), nf-core/sarek `87fd1b416d783b0fc2982c363a6d5458e88726a2` (MIT), Raindrop Workshop `a6b82d71596cf7e8974e5efae63f9e15260d76ef` (MIT).

## Still open

Atlas, Raindrop, and ElevenLabs have no credentials. Those statuses stay `NOT_CONFIGURED`. The release verdict remains **CONDITIONAL GO**.
