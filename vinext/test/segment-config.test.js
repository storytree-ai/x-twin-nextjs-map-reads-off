import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentConfig, pageCacheControl, inStaticParams } from "../src/app/segment-config.js";

const NO_STORE = "private, no-cache, no-store, max-age=0, must-revalidate";

test("segment config merges layouts and the page: the lowest revalidate, any force-dynamic", () => {
  assert.deepEqual(segmentConfig([{ revalidate: 60 }, null, { revalidate: 10 }]), { revalidate: 10, dynamic: undefined, dynamicParams: true });
  assert.equal(segmentConfig([{ dynamic: "force-dynamic" }, {}]).dynamic, "force-dynamic");
  assert.equal(segmentConfig([{}, { dynamicParams: false }]).dynamicParams, false);
});

test("Cache-Control for app pages", () => {
  assert.equal(pageCacheControl({ revalidate: 1 }, { status: 200 }), "s-maxage=1, stale-while-revalidate");
  assert.equal(pageCacheControl({ revalidate: 60, dynamic: "force-dynamic" }, { status: 200 }), NO_STORE);
  assert.equal(pageCacheControl({ revalidate: 60 }, { status: 200, dynamicUsed: true }), NO_STORE);
  assert.equal(pageCacheControl({ revalidate: 0 }, { status: 200 }), NO_STORE);
  assert.equal(pageCacheControl({ revalidate: 60 }, { status: 404 }), NO_STORE);
  assert.equal(pageCacheControl({ revalidate: Infinity }, { status: 200 }), null);
  assert.equal(pageCacheControl({}, { status: 200 }), null);
});

test("dynamicParams=false only allows the params generateStaticParams lists", () => {
  const list = [{ id: "1" }, { id: "2" }];
  assert.equal(inStaticParams(list, { id: "1" }), true);
  assert.equal(inStaticParams(list, { id: "999" }), false);
  assert.equal(inStaticParams([{ slug: ["a", "b"] }], { slug: ["a", "b"] }), true);
  assert.equal(inStaticParams([{ id: 3 }], { id: "3" }), true);
});
