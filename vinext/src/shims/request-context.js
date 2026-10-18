// vinext/unified-request-context (internal): the per-request store the dev
// server renders inside (see server/ssr-context.js), with the fields
// renders may read. Outside a server render it is a throwaway object.
export function getRequestContext() {
  const als = globalThis.__VINEXT_SSR_ALS__;
  const store = (als && als.getStore()) || {};
  if (!store.head) store.head = [];
  if (!("ssrHeadChildren" in store)) {
    Object.defineProperty(store, "ssrHeadChildren", { get: () => store.head, enumerable: true });
  }
  if (store._privateCache === undefined) store._privateCache = null;
  if (!store.serverInsertedHTMLCallbacks) store.serverInsertedHTMLCallbacks = [];
  return store;
}
