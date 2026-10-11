#!/usr/bin/env bash
# V14 Agent 5 verification. Never touches :8000 / :5173.
#
#   scripts/verify_v14.sh [all|ruff|pytest|tsc|vitest|playwright|benchmark]
#
# Throwaway backend: V10_STATE_PATH=/tmp/v14_e2e/state.json  API :8145  web :5145
# Machine-readable JSON lands under artifacts/milestones/v14/.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WEB="$REPO/apps/web"
OUT="$REPO/artifacts/milestones/v14"
LOGS="$OUT/logs"
API_PORT="${E2E_API_PORT:-8145}"
WEB_PORT="${E2E_WEB_PORT:-5145}"
STATE_PATH="${V10_STATE_PATH:-${E2E_STATE_PATH:-/tmp/v14_e2e/state.json}}"
E2E_DIST="${E2E_DIST:-/tmp/v14_e2e_dist}"
PY="${REPO}/.venv/bin/python"
PYTEST="${REPO}/.venv/bin/pytest"
RUFF="${REPO}/.venv/bin/ruff"
CHROMIUM="${E2E_CHROMIUM:-/home/923873155/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell}"

case " $API_PORT $WEB_PORT " in
  *" 8000 "*|*" 5173 "*) echo "refusing: 8000/5173 are the user's live servers"; exit 2 ;;
esac

export E2E_API_PORT="$API_PORT" E2E_WEB_PORT="$WEB_PORT" E2E_STATE_PATH="$STATE_PATH"
export V10_STATE_PATH="$STATE_PATH" E2E_DIST="$E2E_DIST"
mkdir -p "$LOGS" "$OUT" "$(dirname "$STATE_PATH")"
MODE="${1:-all}"

declare -a NAMES STATUSES NOTES
record() { NAMES+=("$1"); STATUSES+=("$2"); NOTES+=("$3"); printf '  [%s] %s  %s\n' "$2" "$1" "$3"; }

write_step_json() {
  local name="$1" status="$2" extra="$3"
  "$PY" - "$OUT/${name}.json" "$name" "$status" "$extra" <<'PY'
import json, sys
path, name, status, extra = sys.argv[1:5]
payload = {"name": name, "status": status}
try:
    payload.update(json.loads(extra))
except Exception:
    payload["detail"] = extra
path_p = __import__("pathlib").Path(path)
path_p.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY
}

STARTED_API=0; STARTED_WEB=0; API_PID=""; WEB_PID=""
cleanup() {
  if [ "$STARTED_WEB" = 1 ] && [ -n "$WEB_PID" ]; then kill -- "-$WEB_PID" 2>/dev/null || kill "$WEB_PID" 2>/dev/null; fi
  if [ "$STARTED_API" = 1 ] && [ -n "$API_PID" ]; then kill -- "-$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null; fi
  return 0
}
trap cleanup EXIT INT TERM

OWNED_PY=(
  "$REPO/services/tests/test_v14_anatomy.py"
  "$REPO/services/tests/test_v14_anatomy_ingest.py"
  "$REPO/services/tests/test_v14_genome_edit.py"
  "$REPO/services/tests/test_v14_guardrails.py"
  "$REPO/services/tests/test_v14_guardrails_reference.py"
  "$REPO/services/tests/test_v14_guardrails_intent.py"
  "$REPO/services/tests/test_v14_guardrails_gwas.py"
  "$REPO/services/tests/test_v14_guardrails_license.py"
  "$REPO/services/tests/test_v14_guardrails_lineage.py"
  "$REPO/services/runtime/anatomy"
  "$REPO/services/runtime/genome_edit"
  "$REPO/services/api/app/routes/anatomy.py"
  "$REPO/services/api/app/routes/genome_edit.py"
  "$REPO/scripts/benchmark_v14.py"
)

run_ruff() {
  local log="$LOGS/ruff.log"
  if [ ! -x "$RUFF" ]; then
    record "ruff (owned python)" BLOCKED "ruff missing in .venv"
    write_step_json ruff BLOCKED '{"reason":"ruff missing"}'
    return
  fi
  local existing=()
  local f
  for f in "${OWNED_PY[@]}"; do [ -e "$f" ] && existing+=("$f"); done
  ( cd "$REPO" && "$RUFF" check "${existing[@]}" ) >"$log" 2>&1
  local rc=$?
  if [ $rc -eq 0 ]; then
    record "ruff (owned python)" PASS "files=${#existing[@]}"
    write_step_json ruff PASS "{\"files\":${#existing[@]},\"rc\":0}"
  else
    record "ruff (owned python)" FAIL "rc=$rc log=artifacts/milestones/v14/logs/ruff.log"
    write_step_json ruff FAIL "{\"rc\":$rc}"
  fi
}

run_pytest() {
  local log="$LOGS/pytest.log"
  local junit="$OUT/pytest.xml"
  if [ ! -x "$PYTEST" ]; then
    record "pytest test_v14_*" BLOCKED "pytest missing"
    write_step_json pytest BLOCKED '{"reason":"pytest missing"}'
    return
  fi
  ( cd "$REPO" && "$PYTEST" -q services/tests/test_v14_*.py \
      --tb=line --junitxml="$junit" ) >"$log" 2>&1
  local rc=$?
  local summary
  summary="$("$PY" - "$junit" "$log" <<'PY'
import json, re, sys, xml.etree.ElementTree as ET
from pathlib import Path
junit, log = Path(sys.argv[1]), Path(sys.argv[2])
passed = failed = skipped = 0
if junit.exists():
    root = ET.parse(junit).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.findall("testsuite"))
    if root.tag == "testsuites" and not suites:
        suites = list(root)
    for suite in suites:
        total = int(suite.attrib.get("tests") or 0)
        failed += int(suite.attrib.get("failures") or 0) + int(suite.attrib.get("errors") or 0)
        skipped += int(suite.attrib.get("skipped") or 0)
        passed += max(0, total - int(suite.attrib.get("failures") or 0) - int(suite.attrib.get("errors") or 0) - int(suite.attrib.get("skipped") or 0))
else:
    text = log.read_text(encoding="utf-8", errors="replace")
    failed = len(re.findall(r"^FAILED ", text, re.M))
    passed = len(re.findall(r"^PASSED ", text, re.M))
print(json.dumps({"passed": passed, "failed": failed, "skipped": skipped}))
PY
)"
  if [ $rc -eq 0 ]; then
    record "pytest test_v14_*" PASS "$summary"
    write_step_json pytest PASS "$summary"
  else
    record "pytest test_v14_*" FAIL "rc=$rc $summary"
    write_step_json pytest FAIL "$summary"
  fi
}

run_tsc() {
  local log="$LOGS/tsc.log"
  ( cd "$WEB" && npx tsc --noEmit ) >"$log" 2>&1
  local rc=$?
  if [ $rc -eq 0 ]; then
    record "tsc --noEmit (apps/web)" PASS "clean"
    write_step_json tsc PASS '{"rc":0}'
  else
    record "tsc --noEmit (apps/web)" FAIL "rc=$rc log=artifacts/milestones/v14/logs/tsc.log"
    write_step_json tsc FAIL "{\"rc\":$rc}"
  fi
}

run_vitest() {
  local log="$LOGS/vitest.log"
  local json="$OUT/vitest.json"
  ( cd "$WEB" && npx vitest run tests/v14 --reporter=json --outputFile="$json" ) >"$log" 2>&1
  local rc=$?
  local summary
  summary="$("$PY" - "$json" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
passed = failed = skipped = 0
if p.exists():
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        for t in data.get("testResults", data.get("tests", [])):
            status = (t.get("status") or t.get("state") or "").lower()
            if status in {"passed", "pass", "expected"}: passed += 1
            elif status in {"failed", "fail", "unexpected"}: failed += 1
            elif status in {"skipped", "pending"}: skipped += 1
        if not passed and not failed:
            counts = data.get("numPassedTests"), data.get("numFailedTests"), data.get("numPendingTests")
            if any(c is not None for c in counts):
                passed, failed, skipped = [int(c or 0) for c in counts]
    except Exception as e:
        print(json.dumps({"parse_error": str(e)}))
        raise SystemExit
print(json.dumps({"passed": passed, "failed": failed, "skipped": skipped}))
PY
)"
  if [ $rc -eq 0 ]; then
    record "vitest tests/v14" PASS "$summary"
    write_step_json vitest PASS "$summary"
  else
    record "vitest tests/v14" FAIL "rc=$rc $summary"
    write_step_json vitest FAIL "$summary"
  fi
}

run_playwright() {
  local log="$LOGS/playwright.log"
  local json="$OUT/playwright.json"
  if [ ! -x "$CHROMIUM" ] || [ ! -d "$WEB/node_modules/@playwright/test" ]; then
    record "playwright e2e/v14" BLOCKED "playwright or chromium missing"
    write_step_json playwright BLOCKED '{"reason":"playwright or chromium missing"}'
    return
  fi
  mkdir -p /tmp/v14_e2e
  ( cd "$WEB" && PW_JSON_OUT="$json" npx playwright test --config e2e/v14/playwright.config.ts ) >"$log" 2>&1
  local rc=$?
  local summary
  summary="$("$PY" - "$json" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
if not p.exists():
    print(json.dumps({"passed": 0, "failed": 0, "skipped": 0, "missing": True}))
    raise SystemExit
j = json.loads(p.read_text(encoding="utf-8"))
s = j.get("stats") or {}
print(json.dumps({
    "passed": s.get("expected", 0),
    "failed": s.get("unexpected", 0),
    "flaky": s.get("flaky", 0),
    "skipped": s.get("skipped", 0),
}))
PY
)"
  if [ $rc -eq 0 ]; then
    record "playwright e2e/v14" PASS "$summary"
    write_step_json playwright PASS "$summary"
  else
    record "playwright e2e/v14" FAIL "rc=$rc $summary log=artifacts/milestones/v14/logs/playwright.log"
    write_step_json playwright FAIL "$summary"
  fi
}

run_benchmark() {
  local log="$LOGS/benchmark.log"
  if [ ! -x "$PY" ]; then
    record "benchmark_v14" BLOCKED "python missing"
    write_step_json benchmark BLOCKED '{"reason":"python missing"}'
    return
  fi
  ( cd "$REPO" && "$PY" "$REPO/scripts/benchmark_v14.py" ) >"$log" 2>&1
  local rc=$?
  if [ $rc -eq 0 ]; then
    record "benchmark_v14" PASS "artifacts/milestones/v14/benchmark.json"
    write_step_json benchmark_step PASS '{"rc":0,"receipt":"artifacts/milestones/v14/benchmark.json"}'
  else
    record "benchmark_v14" FAIL "rc=$rc (missing Agent 2/4 APIs is recorded in benchmark.json)"
    write_step_json benchmark_step FAIL "{\"rc\":$rc}"
  fi
}

echo "=== DIAMOND V14 verification ($(date -u +%FT%TZ)) mode=$MODE ports=:$API_PORT/:$WEB_PORT ==="
echo "    state=$STATE_PATH  (never :8000/:5173)"
case "$MODE" in
  ruff) run_ruff ;;
  pytest) run_pytest ;;
  tsc) run_tsc ;;
  vitest) run_vitest ;;
  playwright) run_playwright ;;
  benchmark) run_benchmark ;;
  all)
    run_ruff
    run_pytest
    run_tsc
    run_vitest
    run_playwright
    run_benchmark
    ;;
  *) echo "unknown mode $MODE"; exit 2 ;;
esac

pass=0; fail=0; blocked=0; skip=0
for s in "${STATUSES[@]}"; do
  case "$s" in PASS) pass=$((pass+1));; FAIL) fail=$((fail+1));; BLOCKED) blocked=$((blocked+1));; SKIP) skip=$((skip+1));; esac
done

{
  echo "{"
  echo "  \"milestone\": \"v14\","
  echo "  \"agent\": 5,"
  echo "  \"generated_at\": \"$(date -u +%FT%TZ)\","
  echo "  \"ports\": {\"api\": $API_PORT, \"web\": $WEB_PORT, \"forbidden\": [8000, 5173]},"
  echo "  \"state_path\": \"$STATE_PATH\","
  echo "  \"steps\": ["
  last=$((${#NAMES[@]} - 1))
  for i in "${!NAMES[@]}"; do
    comma=","; [ "$i" -eq "$last" ] && comma=""
    printf '    {"name": %s, "status": %s, "detail": %s}%s\n' \
      "$("$PY" -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${NAMES[$i]}")" \
      "$("$PY" -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${STATUSES[$i]}")" \
      "$("$PY" -c 'import json,sys; print(json.dumps(sys.argv[1]))' "${NOTES[$i]}")" \
      "$comma"
  done
  echo "  ],"
  echo "  \"summary\": {\"pass\": $pass, \"fail\": $fail, \"blocked\": $blocked, \"skip\": $skip}"
  echo "}"
} >"$OUT/verify-summary.json"

echo
echo "=== SUMMARY: $pass PASS, $fail FAIL, $blocked BLOCKED, $skip SKIP ==="
echo "(json: artifacts/milestones/v14/verify-summary.json)"
if [ $fail -gt 0 ]; then exit 1; fi
if [ $blocked -gt 0 ]; then exit 3; fi
exit 0
