#!/usr/bin/env bash
# The arm's checks: CI runs this on every pull request and in the merge queue.
# Install + build vinext, run its unit tests, then smoke test `vinext dev`
# against copies of apps/pages-basic and apps/app-basic.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VINEXT="$ROOT/vinext"
PORT="${SMOKE_PORT:-3499}"
APP_PORT="${SMOKE_APP_PORT:-3498}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/vinext-checks-XXXXXX")"
SERVER_PID=""
APP_SERVER_PID=""

cleanup() {
  for pid in "$SERVER_PID" "$APP_SERVER_PID"; do
    if [ -n "$pid" ]; then
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    fi
  done
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
[ "$(header x-vinext-cache)" = "MISS" ] || fail "first ISR request was not a MISS"
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

echo "=== vinext: install into apps/app-basic ==="
node "$ROOT/ci/fixture.mjs" app-basic "$TGZ" "$WORK/app-basic"
cd "$WORK/app-basic"
npm install --prefer-offline --offline=false --no-audit --no-fund

echo "=== smoke: App Router, vinext dev -p $APP_PORT ==="
setsid npx vinext dev -p "$APP_PORT" >"$WORK/app-dev.log" 2>&1 &
APP_SERVER_PID=$!
PORT="$APP_PORT"
fail() { echo "FAIL: $1"; echo "--- app dev server log ---"; cat "$WORK/app-dev.log"; exit 1; }

status=""
for _ in $(seq 1 120); do
  status="$(fetch /)"
  [ "$status" = "200" ] && break
  sleep 0.5
done
[ "$status" = "200" ] || fail "app GET / answered '$status', expected 200"
grep -q "<h1>Welcome to App Router</h1>" "$WORK/body.html" || fail "app GET / did not render the server component"
grep -q '<html lang="en">' "$WORK/body.html" || fail "app GET / is not wrapped in the root layout"
grep -q "<title>App Basic</title>" "$WORK/body.html" || fail "app GET / has no metadata title"
grep -q "__vinext_f" "$WORK/body.html" || fail "app GET / has no inline RSC payload"

[ "$(fetch /blog/hello-world)" = "200" ] && grep -q "Slug: <!-- -->hello-world" "$WORK/body.html" || fail "app dynamic route did not render its param"
[ "$(fetch /docs/a/b)" = "200" ] && grep -q "Path: <!-- -->a/b" "$WORK/body.html" || fail "app catch-all route did not render its segments"
[ "$(fetch /interactive)" = "200" ] && grep -q 'data-testid="count"' "$WORK/body.html" || fail "client component was not server-rendered"
[ "$(fetch /nonexistent-page)" = "404" ] && grep -q "404 - Page Not Found" "$WORK/body.html" || fail "unknown app route did not render not-found with 404"
[ "$(fetch /dashboard/missing)" = "404" ] && grep -q "Dashboard: Page Not Found" "$WORK/body.html" || fail "notFound() did not render the nearest not-found with 404"
headers /redirect-test
header location | grep -q "^/about" || fail "redirect() did not answer a redirect to /about"

[ "$(fetch /api/hello)" = "200" ] && grep -q '"message":"Hello from App Router API"' "$WORK/body.html" || fail "route handler GET did not answer JSON"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "http://localhost:$PORT/api/get-only")" = "405" ] || fail "missing route handler method did not answer 405"
curl -s -D "$WORK/headers.txt" -o /dev/null -X OPTIONS "http://localhost:$PORT/api/methods"
[ "$(header allow)" = "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT" ] || fail "OPTIONS did not list the handler's methods"

headers /api/static-data
header cache-control | grep -q "s-maxage=1, stale-while-revalidate" || fail "route handler revalidate did not set s-maxage"
headers /api/force-dynamic-revalidate
header cache-control | grep -q "s-maxage" && fail "force-dynamic route handler was given s-maxage"
headers /api/dynamic-request-headers
header cache-control | grep -q "s-maxage" && fail "route handler reading the request was given s-maxage"
[ "$(fetch /favicon.ico)" = "200" ] || fail "app/favicon.ico was not served"

curl -s -H "RSC: 1" -D "$WORK/headers.txt" -o "$WORK/body.html" "http://localhost:$PORT/about"
header content-type | grep -q "text/x-component" || fail "RSC request did not answer an RSC payload"

# Server actions (the no-JS form path), metadata, segment config, parallel
# routes, middleware rewrites into app routes, error boundaries, "use cache".
fetch /nextjs-compat/action-cookie-phase >/dev/null
ACTION_FIELD="$(grep -oE 'name="\$ACTION_ID_[^"]*"' "$WORK/body.html" | head -n1 | sed 's/^name="//; s/"$//')"
[ -n "$ACTION_FIELD" ] || fail "form with a server action has no \$ACTION_ID_ field"
curl -s -o /dev/null -D "$WORK/headers.txt" -F "$ACTION_FIELD=" "http://localhost:$PORT/nextjs-compat/action-cookie-phase"
grep -qi "^set-cookie: action-cookie=from-action" "$WORK/headers.txt" || fail "server action did not set its cookie"

fetch /metadata-test >/dev/null
grep -q '<meta property="og:title" content="OG Title"/>' "$WORK/body.html" || fail "metadata openGraph was not rendered"
grep -q '<meta name="theme-color" content="#0070f3"/>' "$WORK/body.html" || fail "viewport themeColor was not rendered"
[ "$(fetch /robots.txt)" = "200" ] && grep -q "User-Agent: \*" "$WORK/body.html" || fail "app/robots.ts was not served"

headers /isr-test
header cache-control | grep -q "s-maxage=1, stale-while-revalidate" || fail "revalidate page Cache-Control is wrong"
headers /dynamic-test
header cache-control | grep -q "no-store" || fail "force-dynamic page is not no-store"
[ "$(fetch /products/999)" = "404" ] || fail "dynamicParams=false did not 404 an unknown param"

fetch /dashboard >/dev/null
grep -q 'data-testid="team-slot"' "$WORK/body.html" || fail "parallel @team slot did not render"
fetch /dashboard/settings >/dev/null
grep -q 'data-testid="team-default"' "$WORK/body.html" || fail "parallel slot default.tsx did not render"

curl -s -H "RSC: 1" -H "x-vinext-from: /feed" -o "$WORK/body.html" "http://localhost:$PORT/photos/1"
grep -q "photo-modal" "$WORK/body.html" && grep -q "feed-page" "$WORK/body.html" || fail "navigating from /feed did not intercept /photos/1"
curl -s -H "RSC: 1" -o "$WORK/body.html" "http://localhost:$PORT/photos/1"
grep -q "photo-page" "$WORK/body.html" || fail "/photos/1 without interception did not render the full page"

[ "$(fetch /middleware-rewrite)" = "200" ] && grep -q "Welcome to App Router" "$WORK/body.html" || fail "middleware rewrite did not reach the app route"
[ "$(fetch /error-server-test)" = "200" ] || fail "a server component error under error.tsx did not answer 200"

fetch /use-cache-fn-test >/dev/null
first="$(grep -oE 'data-testid="data-value">[0-9]+' "$WORK/body.html")"
fetch /use-cache-fn-test >/dev/null
[ -n "$first" ] && [ "$first" = "$(grep -oE 'data-testid="data-value">[0-9]+' "$WORK/body.html")" ] || fail "\"use cache\" function was not cached"

echo "=== checks passed ==="
