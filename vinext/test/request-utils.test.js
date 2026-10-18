import { test } from "node:test";
import assert from "node:assert/strict";
import { searchToQuery, trailingSlashRedirect } from "../src/server/request-utils.js";

test("repeated search params become arrays", () => {
  assert.deepEqual(searchToQuery(new URLSearchParams("a=1&b=2&a=3")), { a: ["1", "3"], b: "2" });
});

test("prototype-named keys are ordinary query keys", () => {
  const q = searchToQuery(new URLSearchParams("toString=a&constructor=b&__proto__=c"));
  assert.equal(q.toString, "a");
  assert.equal(q.constructor, "b");
  assert.equal(Object.getPrototypeOf(q), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(q, "__proto__").value, "c");
});

test("trailing slashes redirect to the same path without them", () => {
  assert.equal(trailingSlashRedirect("/about/", "?x=1"), "/about?x=1");
  assert.equal(trailingSlashRedirect("/about", ""), null);
  assert.equal(trailingSlashRedirect("/", ""), null);
});

test("the trailing-slash redirect never leaves the site", () => {
  assert.equal(trailingSlashRedirect("//evil.com/", ""), "/evil.com");
  assert.equal(trailingSlashRedirect("///evil.com//", ""), "/evil.com");
  assert.equal(trailingSlashRedirect("/\\evil.com/", ""), "/evil.com");
});
