# DIAMOND Genome V12: frontend requirements (condensed from the user's master brief)

Scope: FRONTEND ONLY in `apps/web` (existing app, not a new one). Typed adapters and tiny strictly required compat
fixes allowed; never change scientific computation in the backend. Premium scientific-instrument UI, honest science.

## Exactly four top-level tabs, this order, these titles
1. **Genome Editor**  2. **Evolution**  3. **Earth Simulation**  4. **Harness Library**
No Mission/Proof/Harness-Intelligence/fifth tab. Existing capabilities may appear as panels/drawers INSIDE these
tabs where relevant (e.g. validation/evidence receipts in Evolution's evidence drawer, voice briefing "Listen" in Evolution).

Terminology (UI labels and TS names must keep these distinct): *genome state* = reference + ordered in-silico edits;
*harness version* = agent execution strategy/tools/context policy (NOT biology); *workspace* = genome state + active
harness version + evidence + simulation scenarios. Tab 4 is titled "Harness Library" per the user but lists workspaces;
make the distinction explicit in copy.

## Scientific integrity (visible, non-negotiable)
- Edits are "in-silico sequence change" unless lab-verified. Label every claim with exactly one `EvidenceBadge` kind:
  REFERENCE (observed reference), VALIDATED (validated computation), SIMULATED (simulation outcome),
  HYPOTHESIS, INCONCLUSIVE (unavailable/inconclusive).
- The helix may update bases immediately. The human body figure NEVER changes anatomy/colour because a base changed
  (no phenotype claims). If asked, say "No validated body-level effect available".
- Population evolution = stochastic model outputs (mutation, selection, drift, migration), not DNA "wanting" to adapt.
- Never show frequencies/phenotypes/protein folds that were not computed and provenance-linked. No diagnosis/treatment/
  gene-editing procedure claims. Research use only.

## Visual identity
Deep midnight/navy-black; restrained glacial cyan, cobalt, indigo, amethyst; fine illuminated geometry; faint
atmospheric field; precise typography; clean mono for genomic coordinates; restrained glass with sufficient contrast.
AVOID: generic metric-card dashboards, tiny grey text, excessive bloom, unreadable floating labels, oversized neon
buttons, arbitrary particles, big empty cards, animation that fights control, numbered markers for non-sequences,
tracked-out ALL-CAPS eyebrow labels everywhere, one-word accent in headlines. Spend boldness in ONE place per tab.
Layouts must not overlap at 1440x900, 1280x800, 1024x768, 768x1024 tablet, 390x844 phone. Reduced-motion respected.
Persistent shell: brand, active workspace name, reference build id, unsaved-draft indicator, connection status (real API
health, never a fake toggle). Workspace + draft survive tab changes. Do not restart WebGL contexts on tab switch.

## TAB 1 Genome Editor (hero; minimalist)
ONLY: human-body figure + interactive 3D DNA double helix + compact editor (manual selection + text prompt + voice) with
minimal contextual metadata. NO dashboards, harness graphs, environment charts, logs, tables, library grid.
- Desktop: big body in the left column (softly lit, rotatable by drag or one "Turn figure" button, no pseudo-medical hotspots unless grounded),
  large luminous helix centre-right, prompt composer floating at the bottom ("Describe an edit..." + mic + Send/Inspect
  proposal), status chip: Baseline / Draft / Validated / Unsupported / Analysis pending. Detail inspector appears only
  after selecting a base/edit and is collapsible. Resting screen almost free of panels.
- Mobile: body and helix side by side (two columns, no view toggle); composer reachable; workspace context visible.
- Amendment 2026-10-11 (user): no sub-tabs or inner view switches anywhere (V12-ADR-009); big body always visible
  (V12-ADR-010); a draft change triggers an instant acknowledgement pulse (helix flash, arc packet, body scan sweep)
  that never alters anatomy (V12-ADR-011).
- Baseline label: real assembly/reference id/region from `/api/v10/genome/baselines` + `/window` (currently a LOCAL
  SYNTHETIC chr22, official_grch38=false: say so). Never load the whole genome into three.js (windows of ~48 bases).
- Helix: deterministic mapping of the loaded window's real bases (not random letters); complementary pairs (A-T, C-G)
  and correct strand/index mapping; click a base -> coordinate, reference nt, complement, proposed alt. Draft preview
  updates instantly; authoritative saved state only after confirm. Changed bases highlighted; any literal geometric
  distortion must be labelled artistic. Compare original vs draft (one toggle: original helix beside the draft; "was" letters mark changed bases). Undo/Redo for drafts, conflict
  detection if the revision changed remotely, Save as new version, Discard, Restore baseline, with correct disabled states.
  `Restore baseline` / `Compare to baseline` never destroy saved versions.
- Text: user writes e.g. "change the selected nucleotide to A". Frontend builds a STRUCTURED PROPOSAL via
  `POST /api/v10/genome/workspaces/{id}/proposals {position, alt, note}` using a deterministic local grammar parser
  (no interpretation endpoint exists; label "Parsed locally"). Ambiguous/no selection -> ask; never guess a locus. Proposal
  preview shows coordinate, change type, before/after, status/reason, validation state; user must CONFIRM to commit
  (`commit {proposal_id, expected_counter}`, 409 -> conflict UI). Inline status: Interpreting/Validating/Ready to review/
  Unavailable. Only 1-base substitutions are supported by the backend: other operations are "Unsupported" with reason.
- Voice: mic button with visible capture state, elapsed time, cancel, error and permission handling. No backend STT exists
  (ElevenLabs integration is TTS only). Use Web Speech API only as optional progressive enhancement with a clear privacy
  disclosure (audio may leave the device); otherwise show "Voice transcription not configured". Editable final transcript;
  partial transcripts never trigger anything; user confirms transcript AND separately confirms the edit. Handle denied
  permission, unsupported browser, interruption, no speech, network error, long transcript, cancel. Deterministic mock
  transcript adapter for tests. No audio ever changes DNA. Text always works.
- Required states: first visit, baseline loaded, synthetic fallback, loading, base selected, unsaved draft, ambiguous
  prompt, transcript ready, proposed edit, validation pending, rejected, changed draft, saved, disconnected, error,
  WebGL fallback. Semantic DOM mirror (listbox of bases, keyboard operable) for every 3D action.

## TAB 2 Evolution ("what changed since baseline, why, and what evidence")
Two explicitly separated tracks, read-only unless a supported action is invoked:
- **Genome version timeline**: baseline -> proposal -> validation -> saved variant -> branches, from the workspace's
  `revisions` (+ `/intelligence`). Real nucleotide diffs, timestamps, sequence_sha256 evidence.
- **Agent harness timeline**: from `/api/harnesses` + `/api/harnesses/{id}/lineage` (+ evidence receipts). Link to the
  genome track only when ids actually match; otherwise say "no recorded link". Show rejected/failed steps too.
- Accessible timeline/stepper (baseline anchor, current marked), scrubber over events, Compare baseline <-> current with
  DNA-level diff + plain-language explanation; side drawer: What changed / Why / Source / Confidence & limitations / View
  evidence; expandable technical JSON panel; branch picker; optional "Listen" (existing `/api/voice/briefing`, only for
  already-verified narrative). Baseline-only workspace -> polished empty state, no invented ancestors. Selecting an event
  highlights the matching DNA markers and evidence id. Restore/undo lead back to the Editor/Library, never mutate silently.

## TAB 3 Earth Simulation (population-level in-silico evolution sandbox)
Uses `/api/v10/evolution/*`. Wright-Fisher haploid single biallelic locus, 2000-generation budget (409 above).
- Layout: dominant centre 3D Earth/ecosystem scene with abstract population/allele ribbon tied to the active genome;
  left collapsible controls; bottom scrubber (0..horizon) + play/pause/restart/speed (x0.25/.5/1/2/4) + "~60 s playback";
  right concise outcome panel (allele-frequency trajectory chart, extinction status, replicate comparison, plain-language
  explanation linked to real outputs). Rotatable scene; compare two real runs; changing parameters never destroys a
  completed run.
- Horizon default 2,000,000 y; choices 10k/100k/500k/1M/2M and numeric entry. Playback duration is separate from modelled
  time. `visible_year = start_year + (elapsed_s/playback_s)*horizon`. Because of the 2000-generation budget the UI must
  compute `min_generation_time = horizon/2000` and present it as an explicit, editable DECLARED ASSUMPTION; 2M years =>
  >=1000 y/generation. Never fake a 25-year run; surface backend 409 text.
- Parameters come from `/evolution/parameters`: ACTIVE_MODELED ones are "Supported (wired to model)"; NOT_MODELED ones
  (temperature, precipitation, altitude) are shown as context controls with "Exploratory / not supported: does not change
  allele counts". Never imply all Earth factors act on genotype. Presets from `/evolution/environments` (labelled
  fictional/educational, with their source text).
- Changing a parameter edits a DRAFT scenario; results exist only after `Run simulation` returns real frames. States:
  idle/pending/complete/failed (no fake ETA/progress; the request is synchronous). Seed + engine version + fidelity +
  `result_sha256` + limitations displayed. Replicates = N requests with distinct seeds (client-orchestrated, labelled).
  Idempotency-Key per scenario hash. Extinction shown clearly. If the engine is unreachable: "Simulation engine not
  configured/reachable" with a clearly STATIC EXPLANATORY example, never labelled live.
- Playback: requestAnimationFrame time-based, independent of FPS, pause/seek/restart/speed; discrete frames appear at
  their recorded times; interpolation only for safely continuous metrics and labelled; deterministic for a given run.
  Symbolic visuals labelled "Illustrative visualization of model output". Ambient DNA 5-minute morph is subdued/off here.
- Export real frames to CSV/JSON client-side. Switching workspace resets to that workspace's last run (remembered ids).

## TAB 4 Harness Library
Single source of UI truth for choosing workspaces; selection updates tabs 1-3 consistently. Cards/list with workspace
name, reference/baseline id, genome revision, linked harness version, edit count, last saved, evidence status, latest
simulation. Search/filter/sort. Pinned immutable Baseline concept (fork via `branch`, never edit baseline). Actions only
when supported: Select/Activate (`select`), Create (`POST workspaces`), Branch, Compare; Rename/Duplicate/Archive are
DISABLED with explanation (no endpoint). Detail drawer: edit summary, harness summary, simulation runs, branch path,
hashes, evidence status. Active card visibly marked; top bar shows active name.
- `activeWorkspaceId` in `useSession`, URL deep-linkable `?tab=&workspace=`, server authoritative. Query keys include
  workspace id; cancel stale requests; guard out-of-order responses. A->B->A rapid switching correct; refresh restores.
  Unsaved draft on switch -> Save draft / Discard / Cancel switch (`SwitchGuard`). Loading placeholders, no stale flashes.

## Motion
Purposeful only: tab switch eases camera/content (180-450 ms DOM), base selection highlight, evolution node pulls DNA
segment forward, library switch waits for authoritative data. Parameter changes may alter a NON-scientific lighting
preview only. No motion-sickness parallax, no keyboard traps, skeleton loading not spinner-only.

## Rendering/performance
One persistent R3F context; instancing for repeated geometry; no setState per frame; useFrame with delta; no random
re-rolls per render; pause when document hidden; low-power mode; lazy-load heavy parts; measure FPS/long tasks/bundle/
memory after 20 tab switches/WebGL context count; never claim 60 FPS without measurement. Procedural body (no GLB).

## Accessibility/safety
Semantic DOM for every 3D action (keyboard/touch/screen reader), prefers-reduced-motion, focus rings, adequate targets,
aria labels/live regions, never colour alone (A/C/G/T and pass/fail get letters/shapes), mic needs user gesture +
visible indicator + stop/discard. LLM/backend text is untrusted: render as text (no dangerouslySetInnerHTML). No secrets
or raw genomic data/transcripts in browser storage (only nonsensitive UI prefs + simulation ids). No PHI.

## Required tests (E) - see V12 brief section 13
Unit: exactly four tabs in order; Tab1 shows body+DNA+editor and no dashboards; base selection maps to correct coordinate
and complement; manual edit = draft, never commits before confirmation; text sends exact workspace/revision/locus,
ambiguity doesn't mutate; voice transcript requires confirmation and handles denial/unsupported/error/cancel; restore
baseline keeps versions; Tab2 separate tracks with correct diffs; 2M-year->60 s mapping at start/mid/end + pause/seek/
speed with a fake clock; frames belong to the selected run+revision; parameter edits don't fabricate results; library
selection propagates, A->B->A race, refresh/deep link; unsaved-draft switch guard; missing endpoint/provider honest states;
no body morphology from SNP; reduced motion/fallback/keyboard/mobile.
Playwright flows A-H (hero, text edit, voice mock, evolution, simulation, cross-tab library, faults, visual/perf at 5
viewports). Report MOCKED contract passes separately from REAL integrated passes against the live API.
Real integrated flows need the backend: `cd /home/923873155/Diamond_Proj && MONGODB_DATABASE=diamond_v12_e2e V10_STATE_PATH=/tmp/v12_e2e_state.json .venv/bin/uvicorn services.api.app.main:app --port 8000`
(vite dev proxies /api to :8000; check vite.config.ts). Use a throwaway V10_STATE_PATH so repo artifacts are not mutated.
