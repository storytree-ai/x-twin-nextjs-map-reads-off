#!/usr/bin/env bash
# Local runner for the Playwright e2e suite (run_tests.sh hard-codes
# /app/vinext, which only exists in the verifier image).
#
# Usage: bash ci/e2e.sh [spec-filter…]
#   With no filter, runs the whole suite through run_tests.py and filter.json.
#   With filters (substrings of spec paths, e.g. pages-router/navigation),
#   runs only the matching spec files.
#   Either way it prints Playwright's own per-test results at the end.
#
# run_tests.py, filter.json, e2e/ and apps/ are used as they are, copied into
# a scratch dir whose node_modules links to the Playwright install (so
# run_tests.py's `npx playwright` and the specs' imports find one copy).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${VINEXT_E2E_TOOLS:-$HOME/.cache/vinext-e2e-tools}"
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-1.56.1}"

# 1. Tools: @playwright/test (resolved through NODE_PATH, as in the verifier
#    image) and python requests.
if [ ! -x "$TOOLS/node_modules/.bin/playwright" ]; then
  mkdir -p "$TOOLS"
  (cd "$TOOLS" && { [ -f package.json ] || echo '{"name":"vinext-e2e-tools","private":true}' >package.json; } \
    && npm install --prefer-offline --offline=false --no-audit --no-fund "@playwright/test@$PLAYWRIGHT_VERSION")
fi
(cd "$TOOLS" && npx playwright install chromium >/dev/null)
python3 -c "import requests" 2>/dev/null || { echo "python3 'requests' is required"; exit 1; }

# 2. Warm the npm cache with the fixtures' pinned versions: run_tests.py
#    installs them with --offline.
WARM="$TOOLS/warm"
if [ ! -f "$WARM/.done" ]; then
  mkdir -p "$WARM"
  (cd "$WARM" && echo '{"name":"vinext-e2e-warm","private":true}' >package.json \
    && npm install --offline=false --no-audit --no-fund vite@8.0.2 @vitejs/plugin-react@6.0.1 \
      @vitejs/plugin-rsc@0.5.19 react@19.2.4 react-dom@19.2.4 react-server-dom-webpack@19.2.4 \
    && touch .done)
fi

# 3. Build vinext as run_tests.sh does.
(cd "$ROOT/vinext" && npm install --offline --no-audit --no-fund && npm run build)

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/vinext-e2e-XXXXXX")"
trap 'rm -rf "$SCRATCH"' EXIT
cp "$ROOT/run_tests.py" "$ROOT/utils.py" "$ROOT/filter.json" "$SCRATCH/"
cp -r "$ROOT/apps" "$SCRATCH/apps"
ln -s "$TOOLS/node_modules" "$SCRATCH/node_modules"
mkdir -p "$SCRATCH/e2e/app-router" "$SCRATCH/e2e/pages-router"
cp "$ROOT"/e2e/*.ts "$SCRATCH/e2e/"
matched=0
while IFS= read -r spec; do
  rel="${spec#"$ROOT/e2e/"}"
  keep=$(( $# == 0 ))
  for f in "$@"; do [[ "$rel" == *"$f"* ]] && keep=1; done
  if [ "$keep" = 1 ]; then
    mkdir -p "$SCRATCH/e2e/$(dirname "$rel")"
    cp "$spec" "$SCRATCH/e2e/$rel"
    matched=$((matched + 1))
  fi
done < <(find "$ROOT/e2e" -name '*.spec.ts' | sort)
[ "$matched" -gt 0 ] || { echo "no spec file matches: $*"; exit 2; }
echo "Running $matched spec file(s)"

rm -f /tmp/playwright-env-results.json
set +e
(cd "$SCRATCH" && python3 run_tests.py filter.json "$ROOT/vinext") >"$SCRATCH/run.log" 2>&1
set -e
grep -E "^(---|RESULTS|  (Solution|Running|FAILED|Playwright|WARNING|ERROR))" "$SCRATCH/run.log" || true
[ -f /tmp/playwright-env-results.json ] || { echo "no Playwright results; run_tests.py said:"; tail -40 "$SCRATCH/run.log"; exit 1; }

node -e '
const r = JSON.parse(require("fs").readFileSync("/tmp/playwright-env-results.json", "utf8"));
let pass = 0, fail = 0;
const walk = (s, file) => {
  for (const spec of s.specs || []) {
    const ok = spec.ok;
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${file || s.file}: ${spec.title}`);
    if (!ok) for (const t of spec.tests || []) for (const res of t.results || []) {
      if (res.error && res.error.message) { console.log("      " + res.error.message.split("\n").slice(0, 4).join("\n      ")); break; }
    }
  }
  for (const c of s.suites || []) walk(c, file || s.file);
};
for (const s of r.suites || []) walk(s, s.file);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail || !pass ? 1 : 0);
'
