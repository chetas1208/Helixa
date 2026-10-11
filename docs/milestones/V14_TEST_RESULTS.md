# V14 Test Results — Anatomy-First Genome Editor

**Final Verification Run:** **2026-10-11T23:44:27Z**  
**Execution Command:** `bash scripts/verify_v14.sh all` (and `make verify-v14`)  
**Throwaway Isolation:** API port **8145**, Web port **5145**, state path `/tmp/v14_e2e/state.json`. Production ports (8000/5173) strictly untouched.  
**Machine-Readable Receipts:** `artifacts/milestones/v14/verify-summary.json`, `pytest.xml`, `playwright.json`, `benchmark.json`, `demo_summary.json`.

---

## 1. Suite Rollup Summary

| Verification Step | Target / Scope | Result | Detail |
|---|---|---|---|
| **ruff** | Python code quality across V14 tests and runtime | **PASS** | 14 files/dirs, 0 lint errors |
| **pytest** | Full backend test suite (`services/tests/test_v14_*.py`) | **PASS** | **54 passed**, 0 failed, 0 skipped |
| **tsc** | TypeScript type safety (`apps/web`) | **PASS** | Clean (0 errors) |
| **vitest** | Frontend unit & contract specifications (`tests/v14`) | **PASS** | **10 passed**, 0 failed (Full app: 35 files / 417 passed) |
| **playwright** | End-to-end multi-view acceptance suite (`e2e/v14`) | **PASS** | **12 passed**, 0 failed, 0 skipped |
| **benchmark** | Anatomy registry, tree, and parser latency probes | **PASS** | 5/5 probes verified (<500ms) |

**Overall Result: 6 PASS, 0 FAIL, 0 BLOCKED, 0 SKIP (100% SUCCESS)**

---

## 2. Pytest Suite Breakdown (`test_v14_*.py`)

All 54 backend tests pass without mocks masking failure states:

| Test Group | Tests | Result | Highlights / Invariants Verified |
|---|---|---|---|
| `test_v14_anatomy.py` | 12 | PASS | Uberon ontology nodes, laterality split (`UBERON:0002398@left/right`), acyclic tree, search scoring, system associations |
| `test_v14_anatomy_ingest.py` | 1 | PASS | Ingestion manifests, pinned GRCh38 slices exist, zero network dependency during local runs |
| `test_v14_genome_edit.py` | 12 | PASS | Workspace proposals, proposal validation, optimistic concurrency (`expected_counter`), immutable FASTA slices |
| `test_v14_guardrails.py` | 9 | PASS | Expression ≠ causality disclaimers, empty organ honesty (`empty_reason`), `body-descriptor` returns `anatomy_changed=false` |
| `test_v14_guardrails_reference.py` | 8 | PASS | GRCh38 slices checksum match, GRCh37/hg19 rejected with HTTP 400, baseline FASTA immutable across edits |
| `test_v14_guardrails_intent.py` | 6 | PASS | "make my hands bigger" -> `TRAIT_GOAL`, zero mutations drafted, voice transcribe never auto-applies |
| `test_v14_guardrails_gwas.py` | 2 | PASS | GWAS Catalog REST API v2 verified, v1 schema rejected, study accession / PubMed IDs present |
| `test_v14_guardrails_license.py` | 2 | PASS | Zero Z-Anatomy / BodyParts3D assets in repository tree, public asset license compliance |
| `test_v14_guardrails_lineage.py` | 2 | PASS | Genome revision lineage (`kind: GENOME_REVISION`) strictly distinct from harness lineage (`kind: ANALYSIS_HARNESS`) |

---

## 3. Playwright E2E Breakdown (`apps/web/e2e/v14/`)

All 12 browser automation tests pass against the bundled throwaway distribution:

| Spec File | Test Case | Result | Duration | Verified Behavior |
|---|---|---|---|---|
| `crosstab.spec.ts` | save revision → library lists it → editor restores allele | PASS | 5.4s | Cross-tab persistence: edit in Tab 1 restored in Tab 4 |
| `crosstab.spec.ts` | evolution genome lineage is not harness lineage | PASS | 1.3s | Evolution Tab displays separate lineage graphs |
| `science.spec.ts` | head/hand/heart/kidney/foot/spine selectable or searchable | PASS | 2.1s | Full discoverability in AnatomyTree via search & tree nodes |
| `science.spec.ts` | expression panel shows caveat + observed-expression tier | PASS | 2.5s | Disclaimers visible, "genes that control" banned string absent |
| `science.spec.ts` | "make my hands bigger" is a trait goal, not a mutation | PASS | 2.5s | Zero proposals POSTed, workspace edit count remains 0 |
| `science.spec.ts` | 3D DNA allele updates after edit; body geometry unchanged | PASS | 2.1s | `base-list` reflects edit, body descriptor `anatomy_changed=false` |
| `science.spec.ts` | GWAS panel cites Catalog v2 study context when gene opened | PASS | 2.4s | GWAS Catalog REST API v2 citation, PubMed link, p-values |
| `science.spec.ts` | unsupported phenotype is labelled not modeled | PASS | 1.3s | Earth Simulation honesty marker displayed |
| `ux.spec.ts` | first viewport is body + DNA + prompt only | PASS | 2.0s | Contract §0 first screen purity: zero premature dashboards |
| `ux.spec.ts` | voice transcript never auto-applies | PASS | 3.2s | Voice review step required before edit staging |
| `ux.spec.ts` | typed and voice share the same propose path | PASS | 2.9s | Unified command interpreter for both input modalities |
| `ux.spec.ts` | reduced motion still allows an edit | PASS | 2.5s | Accessibility: animation disabled but editor remains fully usable |

---

## 4. Performance Benchmark

Executed in-process by `scripts/benchmark_v14.py`:

| Probe Target | Status | Latency | Target SLA |
|---|---|---|---|
| `anatomy.registry.list_nodes` | OK | 11 ms | <50 ms |
| `GET /api/anatomy/tree` | OK | 68 ms | <1000 ms |
| `GET /api/anatomy/UBERON:0000948/genes` | OK | 22 ms | <200 ms |
| `anatomy.loci.window` | OK | 1 ms | <10 ms |
| `POST /api/genome-edit/interpret-command` | OK | 4 ms | <50 ms |

---

## 5. Root Cause Analysis & Resolutions During Delivery

1. **Test Database Divergence**:
   - *Issue*: `isolated_client` in pytest replaced `v10._store`, but `services/api/app/routes/genome_edit.py` held a separate module reference to `_store`.
   - *Fix*: Refactored `genome_edit.py` to resolve store dynamically via `_get_store()` with fallback to `v10._store`.
2. **Natural Language Trait Parsing**:
   - *Issue*: "make my hands bigger" returned `UNSUPPORTED` instead of `TRAIT_GOAL`.
   - *Fix*: Enhanced `_TRAIT_RULES` in `parser.py` with regex patterns covering anatomical trait wishes.
3. **Evidence Drawer URL Deep-Linking**:
   - *Issue*: Navigating directly with `?anatomy=...` or `?gene=...` did not open the Evidence Drawer in browser tests.
   - *Fix*: Mounted `useAnatomyUrlSync()` inside `App.tsx` and ensured search parameters trigger drawer opening with appropriate expanded sections.
4. **Anatomy Search Latency & Empty Fallbacks**:
   - *Issue*: Rapid search inputs in browser tests checked DOM count before asynchronous HTTP search resolved.
   - *Fix*: Updated `useAnatomySearch` to return synchronous `localHits` while network requests are in flight, and wrapped test search assertions in `expect.poll`.
