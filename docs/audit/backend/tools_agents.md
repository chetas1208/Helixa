# Audit: tools_agents (services/runtime/tools/*, services/runtime/agents/*)

Scope finding: both directories exist but contain no files at all (no `.py`, no `__init__.py`, no hidden files; `find` lists only the two directories; `git log` shows no history for either path). Nothing in `services/` or `scripts/` imports `runtime.tools` or `runtime.agents` (grep over *.py). Subprocess/tool execution lives in `services/runtime/genomics/bcftools_adapter.py` (owned by unit `gen_bcftools`).

## FIXED
None. No source files exist to audit; no tests added (`services/tests/test_audit_tools_agents.py` not created because there is no behavior to cover).

## UNVERIFIED/NEEDS OTHER OWNER
- services/runtime/tools/ and services/runtime/agents/ (directory level): empty, so they are not importable as packages (no `__init__.py`; they would only work as namespace packages). Nothing references them today, so this is not a defect. If agent or tool code was intended to live here, it is absent. Agent/tool logic that does exist is in other units (genomics, harness, orchestration, providers).

## VERIFIED OK
- Confirmed emptiness via `find`, `git status`, `git log` (all read-only).
- Confirmed no importer in `services/` or `scripts/` depends on these paths, so their emptiness breaks nothing.
- ruff and pytest have no files to check for this unit.
