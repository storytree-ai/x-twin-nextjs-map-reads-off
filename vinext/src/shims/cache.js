// next/cache: unstable_cache memoizes data in memory (by key parts and
// arguments, expiring after `revalidate` seconds, dropped by revalidateTag);
// revalidatePath / revalidateTag also mark the current request as
// revalidated, so a server action re-renders the page it was called from.
// cacheLife / cacheTag are accepted for "use cache" code.

const entries = (globalThis.__VINEXT_DATA_CACHE__ ??= new Map());

function requestStore() {
  const als = globalThis.__VINEXT_SSR_ALS__;
  const store = als && als.getStore();
  return store && store.appRequest;
}

function markRevalidated() {
  const store = requestStore();
  if (store) store.revalidated = true;
}

export function unstable_cache(fn, keyParts = [], options = {}) {
  const tags = options.tags || [];
  const revalidate = options.revalidate;
  const base = JSON.stringify([fn.toString(), keyParts]);
  return async (...args) => {
    const key = base + JSON.stringify(args);
    const hit = entries.get(key);
    const fresh = hit && (typeof revalidate !== "number" || Date.now() - hit.at < revalidate * 1000);
    if (fresh) return hit.value;
    const value = await fn(...args);
    entries.set(key, { value, tags, at: Date.now() });
    return value;
  };
}

export function revalidateTag(tag) {
  for (const [key, entry] of entries) if (entry.tags.includes(tag)) entries.delete(key);
  markRevalidated();
}

export const updateTag = revalidateTag;

export function revalidatePath() {
  markRevalidated();
}

export function refresh() {
  markRevalidated();
}

export function unstable_noStore() {
  const store = requestStore();
  if (store) store.dynamicUsed = true;
}

export function cacheLife() {}
export function cacheTag() {}
export { cacheLife as unstable_cacheLife, cacheTag as unstable_cacheTag };
