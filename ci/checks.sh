#!/usr/bin/env bash
# The arm's checks: CI runs this on every pull request and in the merge queue.
# Install + build vinext, run its unit tests, then smoke test `vinext dev`
# against a copy of apps/pages-basic.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VINEXT="$ROOT/vinext"
PORT="${SMOKE_PORT:-3499}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vinext-checks-XXXXXX")"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill -- "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "=== vinext: install, build, unit tests ==="
cd "$VINEXT"
# vinext has no dependencies of its own (its peers are optional), so the
# verifier's `npm install --offline` must succeed with an empty cache too.
npm install --offline --no-audit --no-fund
npm run build
npm test

echo "=== vinext: pack and install into apps/pages-basic ==="
TGZ="$WORK/$(npm pack --pack-destination "$WORK" --silent | tail -n1)"
node "$ROOT/ci/fixture.mjs" pages-basic "$TGZ" "$WORK/pages-basic"
cd "$WORK/pages-basic"
# The fixture's pinned versions may not be in this machine's npm cache:
# allow the registry here (the verifier image has them pre-warmed).
npm install --prefer-offline --offline=false --no-audit --no-fund

echo "=== smoke: vinext --help ==="
npx vinext --help | grep -q "vinext dev"
npx vinext build >/dev/null
npx vinext start --help >/dev/null

echo "=== smoke: vinext dev -p $PORT ==="
setsid npx vinext dev -p "$PORT" >"$WORK/dev.log" 2>&1 &
SERVER_PID=$!

fetch() { curl -s -o "$WORK/body.html" -w '%{http_code}' "http://localhost:$PORT$1" || true; }

status=""
for _ in $(seq 1 120); do
  status="$(fetch /)"
  [ "$status" = "200" ] && break
  sleep 0.5
done

fail() { echo "FAIL: $1"; echo "--- dev server log ---"; cat "$WORK/dev.log"; exit 1; }

[ "$status" = "200" ] || fail "GET / answered '$status', expected 200"
grep -q "Hello, vinext!" "$WORK/body.html" || fail "GET / did not render the home h1"
grep -q '<div id="__next">' "$WORK/body.html" || fail "GET / has no #__next root"
grep -q '__NEXT_DATA__' "$WORK/body.html" || fail "GET / has no __NEXT_DATA__"

[ "$(fetch /about)" = "200" ] || fail "GET /about did not answer 200"
grep -q "<h1>About</h1>" "$WORK/body.html" || fail "GET /about did not render its h1"

[ "$(fetch /posts/123)" = "200" ] || fail "GET /posts/123 did not answer 200"
grep -q "Post: <!-- -->123" "$WORK/body.html" || fail "GET /posts/123 did not render GSSP props"
grep -q "Pathname: <!-- -->/posts/\[id\]" "$WORK/body.html" || fail "GET /posts/123 router.pathname is wrong"

[ "$(fetch /docs/api/v2/users)" = "200" ] || fail "catch-all route did not answer 200"
grep -q "Path: <!-- -->api/v2/users" "$WORK/body.html" || fail "catch-all route did not render its slug"

[ "$(fetch /api/users/42)" = "200" ] || fail "GET /api/users/42 did not answer 200"
grep -q '"name":"User 42"' "$WORK/body.html" || fail "API route did not answer JSON"

[ "$(fetch /does-not-exist)" = "404" ] || fail "unknown route did not answer 404"

# Client navigation data, ISR, middleware and next.config rules.
headers() { curl -s -o "$WORK/body.html" -D "$WORK/headers.txt" "http://localhost:$PORT$1" >/dev/null || true; }
header() { grep -i "^$1:" "$WORK/headers.txt" | head -n1 | cut -d' ' -f2- | tr -d '\r'; }

headers /_next/data/development/posts/7.json
grep -q '"page":"/posts/\[id\]"' "$WORK/body.html" || fail "data route did not answer the page as JSON"
grep -q '"id":"7"' "$WORK/body.html" || fail "data route did not carry GSSP props"

headers /isr-test
[ -n "$(header x-vinext-cache)" ] || fail "ISR page has no X-Vinext-Cache"
header cache-control | grep -q "s-maxage=1, stale-while-revalidate" || fail "ISR page Cache-Control is wrong"
headers /isr-test
[ "$(header x-vinext-cache)" = "HIT" ] || fail "second ISR request was not a HIT"

headers /about
[ "$(header x-custom-middleware)" = "active" ] || fail "middleware header missing on /about"
[ "$(fetch /blocked)" = "403" ] || fail "middleware did not block /blocked"
headers /old-page
header location | grep -q "/about" || fail "middleware did not redirect /old-page"
[ "$(fetch /rewritten)" = "200" ] && grep -q "Hello from getServerSideProps" "$WORK/body.html" || fail "middleware rewrite did not serve /ssr"
headers /old-about
header location | grep -q "^/about" || fail "next.config redirect missing"
[ "$(fetch /after-rewrite)" = "200" ] && grep -q "<h1>About</h1>" "$WORK/body.html" || fail "next.config afterFiles rewrite missing"
[ "$(fetch /cjs/basic)" = "200" ] && grep -q "Random: <!-- -->4" "$WORK/body.html" || fail "CommonJS page did not render"
grep -q 'data-testid="app-wrapper"' "$WORK/body.html" || fail "pages/_app did not wrap the page"

echo "=== checks passed ==="
