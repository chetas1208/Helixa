# V12 frontend agent ownership (exclusive write access)

Working directory `apps/web`. No agent edits a file owned by another; request changes through
`docs/frontend/V12_AGENT_HANDOFFS.md`. Shared contract files (`src/v12/types.ts`, the hook
**signatures** in `src/v12/api/hooks.ts`, and `src/v12/design/*` prop APIs) are frozen: extend only by
adding exports, never by changing existing signatures.

| Agent | Owns (write) |
|---|---|
| **A: Design system + shell** | `src/app/**`, `src/index.css`, `tailwind.config.js`, `index.html`, `src/v12/shell/**` (incl. `SceneHost`, `TopBar`, `TabNav`, mobile tabs, `ConnectionBanner`, `ErrorBoundary`, `Toaster`, ambient backdrop), `src/v12/design/**`, `docs/frontend/V12_DESIGN_SYSTEM.md`. Removes dead legacy UI (`src/features/**`, `src/scenes/**` that nothing imports, `src/components/**` legacy) once nothing references it. |
| **B: Genome Editor + body/DNA 3D** | `src/v12/editor/**`, `docs/frontend/V12_EDITOR_NOTES.md` |
| **C: Evolution + Earth Simulation** | `src/v12/evolution/**`, `src/v12/simulation/**`, `docs/frontend/V12_SIMULATION_NOTES.md` |
| **D: Library + typed data/voice integration** | `src/v12/api/**`, `src/v12/state/**`, `src/v12/library/**`, `docs/frontend/V12_DATA_LAYER_NOTES.md` |
| **E: QA, performance, accessibility** | `apps/web/tests/**`, `apps/web/e2e/**`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, devDependencies in `apps/web/package.json`, `Makefile` targets `verify-v12-ui` / `demo-v12-ui`, `scripts/verify_v12_ui.sh`, `docs/frontend/V12_{ACCESSIBILITY,PERFORMANCE_AND_RENDERING,TEST_RESULTS,DEMO_SCRIPT}.md`, `artifacts/frontend/v12/**` |
| **Lead / integrator** | `PROGRESS.md`, `DECISIONS.md`, `AGENT_OWNERSHIP.md`, `docs/frontend/V12_{BASELINE_AUDIT,INTERFACE_CONTRACTS,REQUIRED_BACKEND_ENDPOINTS,AGENT_HANDOFFS}.md` |

Each agent appends its own dated section to `PROGRESS.md` ONLY via its own notes file named above
(the lead merges them), to avoid concurrent write corruption.

---

# V14 anatomy-first editor (exclusive write access)

Contract: `docs/milestones/V14_UI_CONTRACTS.md`. Frozen shared files: `apps/web/src/v14/contracts.ts` (types only; Agent 4 may add fields, not rename), `apps/web/src/v14/state/anatomySelection.ts` (actions may grow; existing signatures stay). Coordinator owns `PROGRESS.md`, `DECISIONS.md`, this file, `Makefile`, `services/api/app/main.py`.

| Agent | Owns (write) |
|---|---|
| **1 Anatomy atlas + 3D** | `apps/web/src/features/anatomy/**`, `apps/web/public/anatomy/**`, `scripts/anatomy/**`, `apps/web/tests/v14/anatomy*.test.ts`, `docs/milestones/V14_NOTES_AGENT1.md` |
| **2 Evidence + mapping** | `services/runtime/anatomy/**`, `services/api/app/routes/anatomy.py`, `scripts/v14_ingest_sources.py`, `fixtures/v14/**`, `fixtures/references/grch38_slices/**`, `services/tests/test_v14_anatomy*.py`, `docs/milestones/V14_DATA_SOURCES.md`, `docs/milestones/V14_NOTES_AGENT2.md` |
| **3 Editor UX** | `apps/web/src/v12/editor/**`, `apps/web/src/features/genome-editor/**`, `apps/web/tests/v14/editor*.test.ts(x)`, `docs/milestones/V14_NOTES_AGENT3.md` |
| **4 Contracts + persistence** | `services/runtime/genome_workspace/**`, `services/runtime/genome_edit/**`, `services/api/app/routes/genome_edit.py`, `services/api/app/routes/voice.py`, `services/integrations/elevenlabs/**`, `services/integrations/raindrop/**` (additive), `apps/web/src/v14/**` except the frozen signatures above, `services/tests/test_v14_genome_edit*.py`, `apps/web/tests/v14/api*.test.ts`, `docs/milestones/V14_NOTES_AGENT4.md`. Do not edit `src/v12/{evolution,simulation}/**` until V12 Agent C reports done. |
| **5 QA + guardrails** | `apps/web/e2e/v14/**`, `apps/web/tests/v14/guardrails*.test.ts`, `services/tests/test_v14_guardrails*.py`, `scripts/verify_v14.sh`, `scripts/benchmark_v14*`, `artifacts/milestones/v14/**`, `docs/milestones/V14_{TEST_RESULTS,SCIENTIFIC_GUARDRAILS,LICENSE_REVIEW}.md`, `docs/milestones/V14_NOTES_AGENT5.md`. Do not edit existing `apps/web/e2e/{mocked,real,visual}/**` (V12 Agent E). |

V12 exclusive writes still hold for unfinished V12 agents. V14 agents must not touch another agent's files.
