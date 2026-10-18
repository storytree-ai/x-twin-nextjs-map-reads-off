import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePath, matchPath, fillDestination, matchConditions } from "../src/routing/path-match.js";

test("named params and custom regex groups match like path-to-regexp", () => {
  assert.deepEqual(matchPath("/repeat-redirect/:id", "/repeat-redirect/7"), { id: "7" });
  assert.equal(matchPath("/repeat-redirect/:id", "/repeat-redirect/7/8"), null);
  assert.deepEqual(matchPath("/api/(.*)", "/api/hello/x"), { 0: "hello/x" });
  assert.deepEqual(matchPath("/blog/:slug*", "/blog/a/b"), { slug: "a/b" });
  assert.deepEqual(matchPath("/blog/:slug*", "/blog"), { slug: undefined });
  assert.equal(matchPath("/blog/:slug+", "/blog"), null);
  assert.equal(matchPath("/about", "/about-us"), null);
});

test("the middleware matcher's negative lookahead excludes api and _next", () => {
  const source = "/((?!api|_next|favicon\\.ico|mw-object-gated).*)";
  assert.ok(compilePath(source).regex.test("/"));
  assert.ok(compilePath(source).regex.test("/about"));
  assert.ok(!compilePath(source).regex.test("/api/hello"));
  assert.ok(!compilePath(source).regex.test("/_next/data/x/about.json"));
  assert.ok(!compilePath(source).regex.test("/mw-object-gated"));
});

test("destinations fill params, repeated or in the query", () => {
  assert.equal(fillDestination("/docs/:id/:id", { id: "x" }), "/docs/x/x");
  assert.equal(fillDestination("/search?q=:term", { term: "a b" }), "/search?q=a%20b");
});

test("has/missing conditions read headers, cookies, query and host", () => {
  const req = {
    headers: { "x-mw-allow": "1", cookie: "logged-in=1; theme=dark", host: "localhost:3000" },
    query: { tab: "a" },
  };
  assert.ok(matchConditions([{ type: "cookie", key: "logged-in" }], undefined, req));
  assert.ok(!matchConditions(undefined, [{ type: "cookie", key: "logged-in" }], req));
  assert.ok(matchConditions([{ type: "header", key: "x-mw-allow", value: "1" }], [{ type: "cookie", key: "mw-blocked" }], req));
  assert.ok(!matchConditions([{ type: "header", key: "x-mw-allow", value: "2" }], undefined, req));
  assert.ok(matchConditions([{ type: "query", key: "tab" }, { type: "host", value: "localhost" }], undefined, req));
});
