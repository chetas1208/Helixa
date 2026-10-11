# HELIXA — Legacy Name Audit & Migration Inventory
**Document ID:** BRAND-INV-001  
**Timestamp:** 2026-10-11T23:44:30Z  
**Policy:** Non-destructive namespace migration with backward compatibility  

---

## 1. Classification Methodology

Every legacy mention of `DIAMOND`, `diamond`, or `diamond-genome` has been categorized into one of five policy tiers:

| Tier | Classification Category | Action & Retention Policy |
|---|---|---|
| **Tier A** | User-Visible Product Branding | **Replaced with HELIXA** in UI headers, navigation, titles, and public copy. |
| **Tier B** | Historical & Provenance Records | **Preserved unconditionally** to maintain truthful development history and audit logs. |
| **Tier C** | Stable Persisted & API Identifiers | **Preserved with compatibility adapters** (e.g. MongoDB databases, SSE event payloads, legacy routes). |
| **Tier D** | Internal Implementation & Symbols | **Retained or safely aliased** to prevent regression in underlying simulation engines and test harnesses. |
| **Tier E** | Third-Party Citations & Licenses | **Preserved verbatim** (e.g., standard MIT licenses, external benchmark references). |

---

## 2. Summary Totals Across Repository

- **Tier A (User-Visible Replaced/Upgraded):** 91 occurrences across web client
- **Tier B (Historical Provenance Preserved):** 53 occurrences in milestone records
- **Tier C (Persisted Storage & DB Retained):** 9 occurrences across MongoDB / Atlas infrastructure
- **Tier D (Internal Implementation / Test Fixtures):** 299 occurrences in background engines
- **Tier E (Third-Party Licenses & Citations):** 3 occurrences in legal notices

---

## 3. Detailed File Listing & Action Register

| File Path | Tier | Matches | Action Applied |
|---|---|---|---|
| `.env` | Tier D | 4 | Preserved internal symbol compatibility |
| `.env.example` | Tier D | 2 | Preserved internal symbol compatibility |
| `.research/upstream/Biomni/biomni/env_desc.py` | Tier D | 1 | Preserved internal symbol compatibility |
| `.research/upstream/Biomni/biomni/env_desc_cm.py` | Tier D | 1 | Preserved internal symbol compatibility |
| `.research/upstream/Biomni/biomni_env/fixed_env.yml` | Tier D | 1 | Preserved internal symbol compatibility |
| `.research/upstream/gepa/docs/docs/blog/posts/2026-07-30-parallel-proposals/index.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `.research/upstream/gepa/examples/confidence_adapter/outputs/evaluation/emotion_combined.csv` | Tier D | 1 | Preserved internal symbol compatibility |
| `.research/upstream/gepa/examples/confidence_adapter/outputs/evaluation/rotten_tomatoes_combined.csv` | Tier D | 1 | Preserved internal symbol compatibility |
| `.research/upstream/meta-harness/reference_examples/text_classification/data/finer/train.jsonl` | Tier D | 1 | Preserved internal symbol compatibility |
| `.research/upstream/meta-harness/reference_examples/text_classification/data/finer/val.jsonl` | Tier D | 2 | Preserved internal symbol compatibility |
| `BACKEND_AUDIT.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `DECISIONS.md` | Tier B | 5 | Preserved historical; HELIXA adopted forward |
| `DEVELOPMENT_PROVENANCE.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `LICENSE` | Tier E | 1 | Preserved verbatim |
| `Makefile` | Tier D | 12 | Preserved internal symbol compatibility |
| `PROGRESS.md` | Tier B | 2 | Preserved historical; HELIXA adopted forward |
| `README.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `RESEARCH.md` | Tier D | 6 | Preserved internal symbol compatibility |
| `THIRD_PARTY_NOTICES.md` | Tier E | 2 | Preserved verbatim |
| `apps/web/.env` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/.env.example` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/ARCH_3D.md` | Tier A | 3 | Branded as HELIXA / Verified clean |
| `apps/web/agents_manifest.json` | Tier A | 2 | Branded as HELIXA / Verified clean |
| `apps/web/src/features/anatomy/anatomy-mesh-manifest.json` | Tier A | 14 | Branded as HELIXA / Verified clean |
| `apps/web/src/features/anatomy/anatomyTree.local.json` | Tier A | 37 | Branded as HELIXA / Verified clean |
| `apps/web/src/features/anatomy/catalog.ts` | Tier A | 3 | Branded as HELIXA / Verified clean |
| `apps/web/src/features/anatomy/ids.ts` | Tier A | 11 | Branded as HELIXA / Verified clean |
| `apps/web/src/features/genome-editor/localAnatomy.ts` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/src/index.css` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/src/v12/api/simMemory.ts` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/src/v12/design/EvidenceBadge.tsx` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/src/v12/editor/Sprites.tsx` | Tier A | 4 | Branded as HELIXA / Verified clean |
| `apps/web/src/v12/library/libraryModel.ts` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/src/v12/shell/BrandMark.tsx` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/src/v12/shell/renderPrefs.ts` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/src/v14/state/urlParams.ts` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/tests/support/fakeBackend.ts` | Tier A | 2 | Branded as HELIXA / Verified clean |
| `apps/web/tests/v12/staticAudit.test.ts` | Tier A | 1 | Branded as HELIXA / Verified clean |
| `apps/web/tests/v14/anatomyAtlas.test.ts` | Tier A | 2 | Branded as HELIXA / Verified clean |
| `apps/web/tests/v17/brand.test.ts` | Tier A | 2 | Branded as HELIXA / Verified clean |
| `compose.yaml` | Tier C | 2 | Preserved default db; HELIXA aliases supported |
| `docs/agents/HELIXA_V17_INTERFACE_CONTRACTS.md` | Tier D | 4 | Preserved internal symbol compatibility |
| `docs/architecture.md` | Tier D | 2 | Preserved internal symbol compatibility |
| `docs/audit/00_SYSTEM_INVENTORY.md` | Tier D | 2 | Preserved internal symbol compatibility |
| `docs/audit/01_CLAIM_VS_EVIDENCE.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/02_SCIENTIFIC_VALIDITY.md` | Tier D | 2 | Preserved internal symbol compatibility |
| `docs/audit/03_HARNESS_EVOLUTION_FALSIFICATION.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/04_DATABASE_RECOVERY_AND_MEMORY.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/05_RAINDROP_VERIFICATION.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/06_ELEVENLABS_VOICE_VERIFICATION.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/07_UI_3D_AND_ACCESSIBILITY.md` | Tier D | 2 | Preserved internal symbol compatibility |
| `docs/audit/08_SECURITY_PRIVACY_AND_DEPENDENCIES.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/09_E2E_DEMO_EVIDENCE.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/10_RELEASE_VERDICT.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/backend/memory.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/backend/security_review.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/audit/backend/test_infra.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/branding/HELIXA_IDENTITY_GUIDE.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/branding/HELIXA_NAME_AND_PROVENANCE.md` | Tier D | 7 | Preserved internal symbol compatibility |
| `docs/branding/HELIXA_RENAME_INVENTORY.md` | Tier D | 12 | Preserved internal symbol compatibility |
| `docs/coordination/V15_AGENT_STATUS.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/coordination/V15_HANDOFFS.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/coordination/V15_INTERFACES.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/frontend/V12_AGENT_HANDOFFS.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/frontend/V12_DESIGN_SYSTEM.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/frontend/V12_SPEC.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/integrations/V8_ARCHITECTURE_AND_ADAPTER_CONTRACTS.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/integrations/V8_LICENSE_AND_SECURITY_MATRIX.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/integrations/V8_UPSTREAM_REPOSITORY_AUDIT.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `docs/milestones/M01_ARCHITECTURE.md` | Tier B | 3 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M01_BASELINE_AUDIT.md` | Tier B | 2 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M01_DATABASE_SCHEMA.md` | Tier B | 3 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M01_RECOVERY_DESIGN.md` | Tier B | 2 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M01_TEST_RESULTS.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M02_BASELINE_AUDIT.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M02_DATA_CONTRACTS.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M02_EVIDENCE_AND_PROVENANCE.md` | Tier B | 3 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M02_SCIENTIFIC_RULES.md` | Tier B | 4 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/M02_TEST_RESULTS.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V14_DATA_SOURCES.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V14_LICENSE_REVIEW.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V14_NOTES_AGENT1.md` | Tier B | 3 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V14_NOTES_AGENT2.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V14_SCIENTIFIC_GUARDRAILS.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V14_TEST_RESULTS.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V14_UI_CONTRACTS.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V15_API_CONTRACTS.md` | Tier B | 1 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V15_BASELINE_AUDIT.md` | Tier B | 2 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V15_BIOLOGICAL_EVIDENCE_POLICY.md` | Tier B | 3 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V15_FINAL_REPORT.md` | Tier B | 3 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V15_FRONTEND_QA.md` | Tier B | 3 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V15_MODEL_CARD.md` | Tier B | 2 | Preserved historical; HELIXA adopted forward |
| `docs/milestones/V15_NUMERICAL_VALIDATION.md` | Tier B | 2 | Preserved historical; HELIXA adopted forward |
| `docs/scientific-limits.md` | Tier D | 4 | Preserved internal symbol compatibility |
| `docs/sponsor-integration.md` | Tier D | 1 | Preserved internal symbol compatibility |
| `fixtures/v14/anatomy_tree.json` | Tier D | 30 | Preserved internal symbol compatibility |
| `fixtures/v14/bgee_anatomy_map.json` | Tier D | 1 | Preserved internal symbol compatibility |
| `fixtures/v14/systems.json` | Tier D | 11 | Preserved internal symbol compatibility |
| `package.json` | Tier D | 1 | Preserved internal symbol compatibility |
| `pyproject.toml` | Tier D | 2 | Preserved internal symbol compatibility |
