import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { cookies, draftMode, headers, createAppRequestStore, takeSetCookies } from "../src/shims/headers.js";

const als = (globalThis.__VINEXT_SSR_ALS__ ??= new AsyncLocalStorage());
const inRequest = (appRequest, fn) => als.run({ appRequest }, fn);

test("cookies() is usable without await and as a promise", async () => {
  const store = createAppRequestStore({ cookie: "a=1" });
  await inRequest(store, async () => {
    assert.equal(cookies().get("a").value, "1");
    assert.equal((await cookies()).get("a").value, "1");
  });
});

test("cookies are read-only while a page renders", async () => {
  const store = createAppRequestStore({});
  store.phase = "render";
  await inRequest(store, async () => {
    assert.throws(() => cookies().set("x", "1"), /Cookies can only be modified in a Server Action or Route Handler/);
    assert.throws(() => cookies().delete("x"), /Cookies can only be modified/);
  });
  assert.deepEqual(takeSetCookies(store), []);
});

test("cookies set in a server action become Set-Cookie headers", async () => {
  const store = createAppRequestStore({});
  store.phase = "action";
  await inRequest(store, async () => {
    (await cookies()).set("action-cookie", "from-action", { path: "/", httpOnly: true });
  });
  assert.deepEqual(takeSetCookies(store), ["action-cookie=from-action; Path=/; HttpOnly"]);
});

const READONLY_HEADERS = "Headers cannot be modified. Read more: https://nextjs.org/docs/app/api-reference/functions/headers";

test("headers() is usable without await, matching the awaited headers", async () => {
  const store = createAppRequestStore({ "x-iterate-a": "1", "x-iterate-b": "2" });
  await inRequest(store, async () => {
    const sync = headers();
    const awaited = await headers();
    assert.equal(sync.get("x-iterate-a"), "1");
    assert.equal(sync.has("x-iterate-b"), true);
    assert.deepEqual(Array.from(sync), Array.from(awaited.entries()));
    assert.deepEqual([...sync.keys()], [...awaited.keys()]);
    assert.deepEqual([...sync.values()], [...awaited.values()]);
    assert.deepEqual([...sync.entries()], [...awaited.entries()]);
    const seen = [];
    sync.forEach((v, k) => seen.push([k, v]));
    assert.deepEqual(seen, Array.from(awaited));
  });
});

test("headers are read-only, with Next.js's error, sync or awaited", async () => {
  const store = createAppRequestStore({ "x-test-header": "original" });
  await inRequest(store, async () => {
    const sync = headers();
    for (const method of ["set", "append", "delete"]) {
      assert.throws(() => sync[method]("x-test-header", "mutated"), { message: READONLY_HEADERS });
      assert.throws(() => store.readonlyHeaders[method]("x-test-header", "mutated"), { message: READONLY_HEADERS });
    }
    assert.equal(sync.get("x-test-header"), "original");
    assert.equal((await headers()).get("x-test-header"), "original");
  });
});

test("a cookie set without await is read by a later await cookies() and sent", async () => {
  const store = createAppRequestStore({});
  store.phase = "route";
  await inRequest(store, async () => {
    cookies().set("repeat-cookie", "repeat-value", { path: "/", httpOnly: true });
    assert.equal(cookies().get("repeat-cookie").value, "repeat-value");
    assert.equal((await cookies()).get("repeat-cookie").value, "repeat-value");
  });
  assert.deepEqual(takeSetCookies(store), ["repeat-cookie=repeat-value; Path=/; HttpOnly"]);
});

test('dynamic = "error" refuses headers(), cookies() and draftMode() with Next.js\'s words', async () => {
  const store = createAppRequestStore({});
  store.phase = "render";
  store.dynamicShouldError = true;
  store.route = "/nextjs-compat/request-api-dynamic-error";
  const words = (api) =>
    `Route /nextjs-compat/request-api-dynamic-error with \`dynamic = "error"\` couldn't be rendered statically because it used \`${api}\`. See more info here: https://nextjs.org/docs/app/building-your-application/rendering/static-and-dynamic#dynamic-rendering`;
  await inRequest(store, async () => {
    assert.throws(() => headers(), { message: words("headers()") });
    assert.throws(() => cookies(), { message: words("cookies()") });
    await assert.rejects(async () => await draftMode(), { message: words("draftMode()") });
  });
});

test("draftMode() is usable without await", async () => {
  await inRequest(createAppRequestStore({}), async () => {
    assert.equal(draftMode().isEnabled, false);
    assert.equal((await draftMode()).isEnabled, false);
  });
});
