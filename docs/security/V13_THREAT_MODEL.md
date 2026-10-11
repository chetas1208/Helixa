# V13 threat model

- Text instructions that do not name a position and a base return `NEEDS_CLARIFICATION` and create no edit.
- A stated reference base that disagrees with the synthetic FASTA is rejected.
- Apply still requires commit plus the revision counter. Interpret does not commit.
- Repeated `Idempotency-Key` on commit returns the first result.
- Archived workspaces cannot become active.
- Transcribe does not invent text when ElevenLabs is absent.
- No new outbound call sends sequence data.

Authentication is still absent. This remains a local research service.
