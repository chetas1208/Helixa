# V11 provenance and privacy

- Editable sequence: `fixtures/references/ref_synthetic_chr22.fasta`. Not GRCh38. Not a patient sample.
- Checksum is SHA-256 of the concatenated sequence and is returned by `GET /api/v10/genome/baselines`.
- Simulation payloads are hashed. The hash covers frames and the declared model version.
- Narrative text is a template over those fields. It is not an external model call.
- Raindrop and ElevenLabs are not invoked by the V10/V11 routes.
- No raw sequence is added to a new outbound integration in this pass.
