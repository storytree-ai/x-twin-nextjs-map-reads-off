// One AsyncLocalStorage for every server render, kept on globalThis so the
// shims (which also run in the browser and so cannot import node:*) can
// read per-request router state and head elements from it.
import { AsyncLocalStorage } from "node:async_hooks";

const als = (globalThis.__VINEXT_SSR_ALS__ ??= new AsyncLocalStorage());

/** Run fn with a fresh per-request store. */
export function runWithRequestStore(fn) {
  return als.run({}, fn);
}

/** HTML from callbacks a render registered (serverInsertedHTMLCallbacks), once. */
export function takeInsertedHTML() {
  const store = als.getStore();
  const callbacks = (store && store.serverInsertedHTMLCallbacks) || [];
  if (store) store.serverInsertedHTMLCallbacks = [];
  return callbacks.map((cb) => String(cb() ?? "")).join("");
}
