import { test } from "node:test";
import assert from "node:assert/strict";
import { middlewareMatches, interpretMiddlewareResponse } from "../src/server/middleware.js";
import { NextResponse } from "../src/shims/server.js";

const matcher = [
  "/((?!api|_next|favicon\\.ico|mw-object-gated).*)",
  {
    source: "/mw-object-gated",
    has: [{ type: "header", key: "x-mw-allow", value: "1" }],
    missing: [{ type: "cookie", key: "mw-blocked" }],
  },
];
const req = (headers = {}) => ({ headers, query: {} });

test("the matcher selects paths, string or object with has/missing", () => {
  assert.ok(middlewareMatches({ matcher }, "/", req()));
  assert.ok(middlewareMatches({ matcher }, "/about", req()));
  assert.ok(!middlewareMatches({ matcher }, "/api/hello", req()));
  assert.ok(!middlewareMatches({ matcher }, "/mw-object-gated", req()));
  assert.ok(middlewareMatches({ matcher }, "/mw-object-gated", req({ "x-mw-allow": "1" })));
  assert.ok(!middlewareMatches({ matcher }, "/mw-object-gated", req({ "x-mw-allow": "1", cookie: "mw-blocked=1" })));
  assert.ok(middlewareMatches(undefined, "/anything", req()));
});

test("responses read as next, rewrite, redirect or a response of their own", () => {
  const next = NextResponse.next();
  next.headers.set("x-custom-middleware", "active");
  const n = interpretMiddlewareResponse(next, "http://localhost:3000/about");
  assert.equal(n.type, "next");
  assert.deepEqual(n.headers, [["x-custom-middleware", "active"]]);

  const r = interpretMiddlewareResponse(NextResponse.rewrite(new URL("/ssr", "http://localhost:3000")), "http://localhost:3000/rewritten");
  assert.equal(r.type, "rewrite");
  assert.equal(r.url.pathname, "/ssr");

  const red = interpretMiddlewareResponse(NextResponse.redirect(new URL("/about", "http://localhost:3000")), "http://localhost:3000/old-page");
  assert.equal(red.type, "response");

  assert.equal(interpretMiddlewareResponse(new Response("Access Denied", { status: 403 })).type, "response");
  assert.equal(interpretMiddlewareResponse(undefined).type, "next");
});

test("request header overrides replace the request's headers", () => {
  const headers = new Headers({ authorization: "x", cookie: "a=1", host: "h" });
  headers.delete("authorization");
  headers.delete("cookie");
  headers.set("x-from-middleware", "hi");
  const n = interpretMiddlewareResponse(NextResponse.next({ request: { headers } }), "http://h/x");
  assert.deepEqual(n.requestHeaders, { host: "h", "x-from-middleware": "hi" });
  assert.deepEqual(n.headers, []);
});
