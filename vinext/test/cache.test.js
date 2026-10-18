import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_cache, revalidatePath, revalidateTag, unstable_noStore } from "../src/shims/cache.js";

const als = (globalThis.__VINEXT_SSR_ALS__ ??= new AsyncLocalStorage());

test("unstable_cache memoizes by key parts and arguments", async () => {
  let calls = 0;
  const get = unstable_cache(async (n) => ({ n, call: ++calls }), ["memo-test"]);
  assert.deepEqual(await get(1), { n: 1, call: 1 });
  assert.deepEqual(await get(1), { n: 1, call: 1 });
  assert.deepEqual(await get(2), { n: 2, call: 2 });
});

test("revalidateTag drops unstable_cache entries with that tag", async () => {
  let calls = 0;
  const get = unstable_cache(async () => ++calls, ["tag-test"], { tags: ["t1"] });
  assert.equal(await get(), 1);
  assert.equal(await get(), 1);
  revalidateTag("t1");
  assert.equal(await get(), 2);
});

test("unstable_cache entries expire after revalidate seconds", async () => {
  let calls = 0;
  const get = unstable_cache(async () => ++calls, ["ttl-test"], { revalidate: 0.05 });
  assert.equal(await get(), 1);
  assert.equal(await get(), 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(await get(), 2);
});

test("revalidatePath / revalidateTag mark the request revalidated; noStore marks it dynamic", () => {
  const appRequest = {};
  als.run({ appRequest }, () => {
    revalidatePath("/x");
    unstable_noStore();
  });
  assert.equal(appRequest.revalidated, true);
  assert.equal(appRequest.dynamicUsed, true);
});
