# V8 license and security matrix

| Item | License basis | Security control | Residual risk |
|---|---|---|---|
| EBI release binaries v0.10.2 | Apache-2.0 upstream project. Binaries are the published release assets, checksum-pinned in `third_party/ebi-vcf-validator/v0.10.2/SHA256SUMS`. | `shell=False`, fixed argv, timeout, checksum gate, no host Docker socket. | A compromised upstream release would still be executed if the recorded checksum matched. The pin is the control. |
| gepa 0.1.4 | MIT. Installed from the pinned checkout with `--no-deps`, so litellm, wandb, and mlflow were not installed. | `optimize()` is not invoked. No genomic text is sent to a reflection model. | Importing the package does not by itself call a model. A later caller could. `guard` is the status flag, not a sandbox around a future call. |
| Biomni checkout | Apache-2.0 for the repository. Bundled scientific resources were not used. | The package is not imported. Consequence annotation raises `PermissionError`. Liftover without a chain returns `INCONCLUSIVE`. Shell fragments and `..` paths are rejected. | Schema names in `capability_manifest.py` are DIAMOND descriptions of a narrow local tool, not a copy of Biomni function bodies. |
| Meta-Harness checkout | MIT. | Not imported. Candidates cannot add tools outside `PolicyEnvelope`. | The class name `MetaHarnessSearchAdapter` describes the design reference. Provenance stored on patches is `DETERMINISTIC`. |
| Raindrop / ElevenLabs | Existing adapters. | No credentials in this run. Status `NOT_CONFIGURED`. Briefing text is the existing template and does not include the VCF body. | A later enabled key would send the briefing script, which is required to stay free of sequence bodies. |
| MongoDB | Existing PyMongo client. | `verify-v8-atlas` refuses localhost. The pointer test deletes only namespace `v8-pointer-test`. | Atlas was not configured, so cloud durability is not claimed. |

Rejected:

- Full Biomni agent execution.
- `bcftools norm --check-ref s` (already forbidden).
- Clinical consequence strings.
- Treating header `##reference` or tool agreement as proof of GRCh38.
- Sending raw VCF bodies to telemetry.
