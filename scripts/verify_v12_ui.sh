#!/usr/bin/env bash
# DIAMOND Genome V12 frontend verification (Agent E).
#
#   scripts/verify_v12_ui.sh [all|static|unit|build|mocked|real|visual|demo]
#
# Steps and what they honestly mean:
#   static  tsc --noEmit (strict), tsc for e2e, banned-pattern source audit (no ESLint is configured in this repo)
#   unit    vitest (node default, jsdom per file)
#   build   vite build -> /tmp, bundle size, secrets-in-bundle grep
#   mocked  Playwright, route-intercepted FakeBackend  -> "MOCKED contract" passes
#   real    Playwright against the live FastAPI backend (throwaway state) -> "REAL integrated" passes
#   visual  Playwright viewport matrix + axe + perf + privacy (live backend) -> REAL
# Exit codes: 0 all PASS (BLOCKED steps allowed only if none FAILED and BLOCKED_OK=1), 1 any FAIL, 3 BLOCKED without FAIL.
# Hardware note: all rendering/FPS numbers come from software-rendered (SwiftShader) headless Chromium.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
WEB="$REPO/apps/web"
OUT="$REPO/artifacts/frontend/v12"
LOGS="$OUT/logs"
# Agent E's own ports and throwaway store. 8000/5173 are the user's live servers on the REAL store (never touched);
# 8301/8302/5301/5302 belong to agents C and D.
API_PORT="${E2E_API_PORT:-8303}"
WEB_PORT="${E2E_WEB_PORT:-5303}"
STATE_PATH="${E2E_STATE_PATH:-/tmp/v12_e_state.json}"
case " $API_PORT $WEB_PORT " in *" 8000 "*|*" 5173 "*) echo "refusing: 8000/5173 are the user's live servers"; exit 2;; esac
export E2E_API_PORT="$API_PORT" E2E_WEB_PORT="$WEB_PORT" E2E_STATE_PATH="$STATE_PATH"
CHROMIUM="${E2E_CHROMIUM:-/home/923873155/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell}"
mkdir -p "$LOGS" "$OUT/screenshots"
MODE="${1:-all}"

declare -a NAMES STATUSES NOTES
record() { NAMES+=("$1"); STATUSES+=("$2"); NOTES+=("$3"); printf '  [%s] %s  %s\n' "$2" "$1" "$3"; }

STARTED_API=0; STARTED_WEB=0; API_PID=""; WEB_PID=""
# Servers are started with setsid, so each PID is a process-group leader and the whole tree (npm -> sh -> node) dies.
cleanup() {
  if [ "$STARTED_WEB" = 1 ] && [ -n "$WEB_PID" ]; then kill -- "-$WEB_PID" 2>/dev/null || kill "$WEB_PID" 2>/dev/null; fi
  if [ "$STARTED_API" = 1 ] && [ -n "$API_PID" ]; then kill -- "-$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null; fi
  return 0
}
trap cleanup EXIT INT TERM

wait_http() { # url, seconds
  local i; for i in $(seq 1 "$2"); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done; return 1
}

start_api() {
  if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null; then echo "  (reusing API already on :$API_PORT)"; return 0; fi
  if [ ! -x "$REPO/.venv/bin/uvicorn" ]; then return 1; fi
  rm -f "$STATE_PATH" # fresh throwaway store per run (only when WE start the API)
  ( cd "$REPO"; MONGODB_DATABASE=diamond_v12_e V10_STATE_PATH="$STATE_PATH" \
      setsid nohup .venv/bin/uvicorn services.api.app.main:app --host 127.0.0.1 --port "$API_PORT" >"$LOGS/api.log" 2>&1 & echo $! >"$LOGS/api.pid" )
  API_PID="$(cat "$LOGS/api.pid")"; STARTED_API=1
  wait_http "http://127.0.0.1:$API_PORT/api/health" 40
}

start_web() { # dev server (demo only). Playwright runs serve a production build via `vite preview` (see playwright.config.ts).
  if curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/" 2>/dev/null; then echo "  (reusing vite already on :$WEB_PORT)"; return 0; fi
  ( cd "$WEB"; setsid nohup npx vite --config e2e/vite.e2e.config.ts >"$LOGS/vite.log" 2>&1 & echo $! >"$LOGS/vite.pid" )
  WEB_PID="$(cat "$LOGS/vite.pid")"; STARTED_WEB=1
  wait_http "http://127.0.0.1:$WEB_PORT/" 60
}

step() { # name, logfile-basename, command...
  local name="$1" log="$LOGS/$2.log"; shift 2
  ( cd "$WEB" && "$@" ) >"$log" 2>&1
  local rc=$?
  if [ $rc -eq 0 ]; then record "$name" PASS "log: artifacts/frontend/v12/logs/$(basename "$log")"; else record "$name" FAIL "rc=$rc, log: artifacts/frontend/v12/logs/$(basename "$log")"; fi
  return $rc
}

# ---------------------------------------------------------------- static
run_static() {
  step "tsc --noEmit (strict, src+tests)" tsc npx tsc --noEmit
  step "tsc e2e project" tsc_e2e npx tsc -p e2e/tsconfig.json
  # banned-pattern audit over product source (comments mentioning the words are filtered by requiring code-like usage)
  local f="$LOGS/source_audit.log"; : >"$f"; local bad=0
  audit() { # label, regex, extra grep args...
    local label="$1" re="$2"; shift 2
    local hits; hits="$(grep -rnE "$re" "$WEB/src/v12" "$WEB/src/app" "$@" --include=*.ts --include=*.tsx 2>/dev/null | grep -v '\.test\.' | grep -vE '^\S+:\s*[0-9]+:\s*(//|\*|/\*)' )"
    if [ -n "$hits" ]; then echo "## $label" >>"$f"; echo "$hits" >>"$f"; bad=1; fi
  }
  audit "dangerouslySetInnerHTML / innerHTML / outerHTML" '(dangerouslySetInnerHTML|[^a-zA-Z]innerHTML|outerHTML|insertAdjacentHTML)'
  audit "eval / new Function / document.write" '(\beval\(|new Function\(|document\.write\()'
  audit "hard-coded credential-looking strings" '(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|api[_-]?key["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9_\-]{16,}|Bearer [A-Za-z0-9\-_.]{20,})'
  audit "external network targets in source (only same-origin /api expected)" "(fetch|axios|XMLHttpRequest|WebSocket|EventSource)[^;]*['\"\`]https?://"
  if [ $bad -eq 0 ]; then record "source audit (innerHTML/eval/secrets/external hosts)" PASS "no hits"; else record "source audit (innerHTML/eval/secrets/external hosts)" FAIL "see artifacts/frontend/v12/logs/source_audit.log"; fi
}

# ---------------------------------------------------------------- unit
run_unit() { step "vitest (unit + jsdom component)" vitest npx vitest run; }

# ---------------------------------------------------------------- build
run_build() {
  local dist=/tmp/v12_dist_check
  step "vite build" vite_build npx vite build --outDir "$dist" --emptyOutDir
  if [ -d "$dist/assets" ]; then
    node -e '
      const fs=require("fs"),path=require("path"),zlib=require("zlib");
      const dir=process.argv[1]; const rows=[];
      for (const f of fs.readdirSync(dir+"/assets")) { const b=fs.readFileSync(path.join(dir,"assets",f)); rows.push({file:f,bytes:b.length,gzip:zlib.gzipSync(b).length}); }
      rows.sort((a,b)=>b.bytes-a.bytes);
      const tot=rows.reduce((s,r)=>({bytes:s.bytes+r.bytes,gzip:s.gzip+r.gzip}),{bytes:0,gzip:0});
      fs.writeFileSync(process.argv[2],JSON.stringify({total:tot,files:rows},null,2));
      console.log("bundle total",(tot.bytes/1024).toFixed(0),"KiB raw,",(tot.gzip/1024).toFixed(0),"KiB gzip");
      for (const r of rows.slice(0,8)) console.log(" ",r.file.padEnd(40),(r.bytes/1024).toFixed(0).padStart(6),"KiB",(r.gzip/1024).toFixed(0).padStart(6),"KiB gz");
    ' "$dist" "$OUT/bundle-size.json" >"$LOGS/bundle.log" 2>&1
    # secrets / forbidden strings in the built bundle
    local hits; hits="$(grep -rlEi '(sk-[A-Za-z0-9]{20,}|xi-api-key|ELEVENLABS_API_KEY|MONGODB_URI|mongodb\+srv://|BEGIN (RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16})' "$dist" 2>/dev/null)"
    if [ -z "$hits" ]; then record "built bundle contains no API keys/secrets" PASS "grep of dist clean"; else record "built bundle contains no API keys/secrets" FAIL "hits: $hits"; fi
    # no dangerouslySetInnerHTML in product chunks (React DOM itself defines the prop name, so check our source instead: done in static)
  else
    record "bundle analysis" BLOCKED "no dist produced"
  fi
}

# ---------------------------------------------------------------- playwright
pw_available() { [ -x "$CHROMIUM" ] && [ -d "$WEB/node_modules/@playwright/test" ]; }

summarize_pw() { # json file -> "p passed, f failed, s skipped"
  node -e '
    const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const s=j.stats||{};
    console.log(JSON.stringify({passed:s.expected||0,failed:s.unexpected||0,flaky:s.flaky||0,skipped:s.skipped||0}));
  ' "$1" 2>/dev/null
}

run_pw() { # label, project, needs_backend(0/1)
  local label="$1" project="$2" needs="$3"
  if ! pw_available; then record "$label" BLOCKED "playwright or chromium missing ($CHROMIUM)"; return; fi
  if [ "$needs" = 1 ] && ! start_api; then record "$label" BLOCKED "backend could not start on :$API_PORT (see logs/api.log)"; return; fi
  if [ "$needs" = 1 ]; then "$REPO/.venv/bin/python" "$REPO/scripts/seed_v12_demo.py" --api "http://127.0.0.1:$API_PORT" >"$LOGS/seed_e2e.json" 2>"$LOGS/seed_e2e.err" || echo "  (seed failed: see logs/seed_e2e.err; real flows create their own data)"; fi
  local json="$OUT/playwright-$project.json" log="$LOGS/playwright-$project.log"
  ( cd "$WEB" && PW_JSON_OUT="$json" npx playwright test --project="$project" ) >"$log" 2>&1
  local rc=$?
  export E2E_SKIP_BUILD=1 # the production bundle in /tmp/v12_e_dist is fresh for the remaining projects of this run
  local sum; sum="$(summarize_pw "$json")"
  local kind="MOCKED"; [ "$needs" = 1 ] && kind="REAL"
  if [ $rc -eq 0 ]; then record "$label [$kind]" PASS "$sum"; else record "$label [$kind]" FAIL "rc=$rc $sum, log: artifacts/frontend/v12/logs/playwright-$project.log"; fi
}

# ---------------------------------------------------------------- demo
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

run_demo() {
  # Fresh throwaway store on Agent E's demo ports (default API :8303, vite :5303). Never 8000/5173 and never an
  # already-occupied port (an unknown server there could hold someone else's store). DEMO_SMOKE=1: check and exit.
  API_PORT="${DEMO_API_PORT:-$API_PORT}"; WEB_PORT="${DEMO_WEB_PORT:-$WEB_PORT}"
  export E2E_API_PORT="$API_PORT" E2E_WEB_PORT="$WEB_PORT"
  port_free "$API_PORT" || { echo "port $API_PORT is in use; set DEMO_API_PORT to a free port"; exit 1; }
  port_free "$WEB_PORT" || { echo "port $WEB_PORT is in use; set DEMO_WEB_PORT to a free port"; exit 1; }
  local state; state="$(mktemp -d /tmp/v12_demo_XXXXXX)/state.json"
  ( cd "$REPO"; MONGODB_DATABASE=diamond_v12_demo V10_STATE_PATH="$state" setsid nohup .venv/bin/uvicorn services.api.app.main:app --host 127.0.0.1 --port "$API_PORT" >"$LOGS/api_demo.log" 2>&1 & echo $! >"$LOGS/api.pid" )
  API_PID="$(cat "$LOGS/api.pid")"; STARTED_API=1
  wait_http "http://127.0.0.1:$API_PORT/api/health" 40 || { echo "backend failed to start (see $LOGS/api_demo.log)"; exit 1; }
  "$REPO/.venv/bin/python" "$REPO/scripts/seed_v12_demo.py" --api "http://127.0.0.1:$API_PORT" >"$LOGS/seed_demo.json" || { echo "seed failed"; exit 1; }
  start_web || { echo "vite failed to start (see $LOGS/vite.log)"; exit 1; }
  local hid; hid="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["hypoxia_study"])' "$LOGS/seed_demo.json")"
  echo
  echo "DIAMOND Genome V12 UI demo"
  echo "  UI        : http://127.0.0.1:$WEB_PORT/?tab=editor&workspace=$hid"
  echo "  Evolution : http://127.0.0.1:$WEB_PORT/?tab=evolution&workspace=$hid"
  echo "  Simulation: http://127.0.0.1:$WEB_PORT/?tab=simulation&workspace=$hid"
  echo "  Library   : http://127.0.0.1:$WEB_PORT/?tab=library&workspace=$hid"
  echo "  API       : http://127.0.0.1:$API_PORT/api/health   (throwaway state: $state)"
  echo "  Workspaces: Baseline (untouched), Hypoxia study (3 edits, 2 runs, active), Hypoxia study / variant B"
  echo "  Script    : docs/frontend/V12_DEMO_SCRIPT.md"
  echo "  Note: the API accepts writes only from Origin :5173; this vite proxy presents that Origin."
  if [ "${DEMO_SMOKE:-0}" = 1 ]; then
    local ok=1 n
    curl -fsS "http://127.0.0.1:$WEB_PORT/" | grep -q '<div id="root"' && echo "  smoke: UI html served" || { echo "  smoke: UI html NOT served"; ok=0; }
    n="$(curl -fsS "http://127.0.0.1:$WEB_PORT/api/v10/genome/workspaces" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["workspaces"]))')"
    [ "${n:-0}" -ge 3 ] && echo "  smoke: $n workspaces through the vite proxy" || { echo "  smoke: expected >=3 workspaces via proxy, got ${n:-none}"; ok=0; }
    n="$(curl -fsS "http://127.0.0.1:$WEB_PORT/api/v10/evolution/simulations?workspace_id=$hid" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["simulations"]))')"
    [ "${n:-0}" -ge 2 ] && echo "  smoke: $n real simulation runs on Hypoxia study" || { echo "  smoke: expected >=2 runs, got ${n:-none}"; ok=0; }
    [ $ok = 1 ] && { echo "DEMO SMOKE PASS (servers stopped)"; exit 0; } || { echo "DEMO SMOKE FAIL"; exit 1; }
  fi
  echo "Press Ctrl+C to stop."
  while true; do sleep 3600; done
}

# ---------------------------------------------------------------- main
echo "=== DIAMOND Genome V12 UI verification ($(date -u +%FT%TZ)) mode=$MODE ==="
case "$MODE" in
  demo)   run_demo; exit 0 ;;
  static) run_static ;;
  unit)   run_unit ;;
  build)  run_build ;;
  mocked) run_pw "Playwright flows (route-intercepted)" mocked 0 ;;
  real)   run_pw "Playwright flows (live backend)" real 1 ;;
  visual) run_pw "Playwright viewport/axe/perf/privacy (live backend)" visual 1 ;;
  all)
    run_static; run_unit; run_build
    run_pw "Playwright flows (route-intercepted)" mocked 0
    run_pw "Playwright flows (live backend)" real 1
    run_pw "Playwright viewport/axe/perf/privacy (live backend)" visual 1 ;;
  *) echo "unknown mode $MODE"; exit 2 ;;
esac

# ---------------------------------------------------------------- summary
pass=0; fail=0; blocked=0
{
  echo "V12 UI verification summary ($(date -u +%FT%TZ)); rendering numbers are SOFTWARE (SwiftShader) headless Chromium"
  for i in "${!NAMES[@]}"; do printf '%-8s %s  -- %s\n' "${STATUSES[$i]}" "${NAMES[$i]}" "${NOTES[$i]}"; done
} >"$OUT/verify-summary.txt"
for s in "${STATUSES[@]}"; do case "$s" in PASS) pass=$((pass+1));; FAIL) fail=$((fail+1));; BLOCKED) blocked=$((blocked+1));; esac; done
echo
echo "=== SUMMARY: $pass PASS, $fail FAIL, $blocked BLOCKED ==="
echo "(details: artifacts/frontend/v12/verify-summary.txt)"
if [ $fail -gt 0 ]; then exit 1; fi
if [ $blocked -gt 0 ] && [ "${BLOCKED_OK:-0}" != 1 ]; then exit 3; fi
exit 0
