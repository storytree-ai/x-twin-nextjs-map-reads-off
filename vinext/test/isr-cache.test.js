import { test } from "node:test";
import assert from "node:assert/strict";
import { createIsrCache, isrCacheControl } from "../src/server/isr-cache.js";

test("MISS, HIT within revalidate, STALE after it with one background regeneration, then HIT", async () => {
  let now = 1000;
  let renders = 0;
  const cache = createIsrCache({ now: () => now });
  const render = async () => ({ value: ++renders, revalidate: 1 });

  const a = await cache.get("/isr", render);
  assert.deepEqual([a.state, a.entry.value], ["MISS", 1]);
  const b = await cache.get("/isr", render);
  assert.deepEqual([b.state, b.entry.value], ["HIT", 1]);

  now += 1500;
  const c = await cache.get("/isr", render);
  assert.deepEqual([c.state, c.entry.value], ["STALE", 1]);
  const d = await cache.get("/isr", render);
  assert.equal(d.state === "STALE" || d.state === "HIT", true);
  await cache.settled();
  assert.equal(renders, 2, "a stale entry regenerates once");
  const e = await cache.get("/isr", render);
  assert.deepEqual([e.state, e.entry.value], ["HIT", 2]);
});

test("a render without revalidate is not cached", async () => {
  const cache = createIsrCache();
  let renders = 0;
  const render = async () => ({ value: ++renders, revalidate: undefined });
  assert.equal((await cache.get("/x", render)).state, null);
  assert.equal((await cache.get("/x", render)).state, null);
  assert.equal(renders, 2);
});

test("Cache-Control follows Next.js: s-maxage and the rest of a year as stale-while-revalidate", () => {
  assert.equal(isrCacheControl(1), "s-maxage=1, stale-while-revalidate=31535999");
});
