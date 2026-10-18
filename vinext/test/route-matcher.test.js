import { test } from "node:test";
import assert from "node:assert/strict";
import { createPatternMatcher } from "../src/client/route-matcher.js";

const match = createPatternMatcher(["/", "/posts/missing", "/posts/[id]", "/docs/[...slug]", "/[[...rest]]"]);

test("the browser's matcher finds the pattern and the new URL's params", () => {
  assert.deepEqual(match("/posts/2"), { pattern: "/posts/[id]", params: { id: "2" } });
  assert.deepEqual(match("/posts/missing"), { pattern: "/posts/missing", params: {} });
  assert.deepEqual(match("/docs/a/b%20c"), { pattern: "/docs/[...slug]", params: { slug: ["a", "b c"] } });
});

test("a root optional catch-all matches / with no params", () => {
  const rootOnly = createPatternMatcher(["/[[...slug]]"]);
  assert.deepEqual(rootOnly("/"), { pattern: "/[[...slug]]", params: {} });
  assert.deepEqual(rootOnly("/x/y"), { pattern: "/[[...slug]]", params: { slug: ["x", "y"] } });
  assert.equal(createPatternMatcher(["/about"])("/nope"), null);
});
