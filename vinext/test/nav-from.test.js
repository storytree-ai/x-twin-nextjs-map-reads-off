import { test } from "node:test";
import assert from "node:assert/strict";
import { navigationSource, historyState } from "../src/app/nav-from.js";

test("a link navigation leaves the current page", () => {
  assert.equal(navigationSource("push", "/photos/1", "/feed", null), "/feed");
  assert.equal(navigationSource("replace", "/photos/1", "/feed", null), "/feed");
});

test("history back and forward restore the page an entry was reached from", () => {
  // Forward to /photos/1, which was intercepted from /feed: the modal again.
  const state = historyState(3, "/feed");
  assert.equal(navigationSource("pop", "/photos/1", "/photos/1", state), "/feed");
  assert.equal(navigationSource("refresh", "/photos/1", "/photos/1", state), "/feed");
});

test("an entry vinext did not push renders as itself", () => {
  assert.equal(navigationSource("pop", "/feed", "/feed", null), "/feed");
  assert.equal(navigationSource("pop", "/feed", "/feed", { app: "data" }), "/feed");
});
