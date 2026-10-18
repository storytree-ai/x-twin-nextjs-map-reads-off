import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { cookies, createAppRequestStore, takeSetCookies } from "../src/shims/headers.js";

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
