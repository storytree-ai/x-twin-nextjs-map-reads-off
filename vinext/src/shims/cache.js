// next/cache: unstable_cache memoizes data in memory (by key parts and
// arguments, expiring after `revalidate` seconds, dropped by revalidateTag);
// revalidatePath / revalidateTag also mark the current request as
// revalidated, so a server action re-renders the page it was called from.
// "use cache" functions run through __vinext_useCache (see
// plugins/use-cache.js): their results are kept per arguments for their
// cacheLife profile and dropped by revalidateTag of a cacheTag they set.

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
  for (const map of [entries, useCacheEntries]) {
    for (const [key, entry] of map) if (entry.tags.includes(tag)) map.delete(key);
  }
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

// Seconds; Next.js's built-in cacheLife profiles.
const PROFILES = {
  default: { stale: 300, revalidate: 900, expire: Infinity },
  seconds: { stale: 30, revalidate: 1, expire: 60 },
  minutes: { stale: 300, revalidate: 60, expire: 3600 },
  hours: { stale: 300, revalidate: 3600, expire: 86400 },
  days: { stale: 300, revalidate: 86400, expire: 604800 },
  weeks: { stale: 300, revalidate: 604800, expire: 2592000 },
  max: { stale: 300, revalidate: 2592000, expire: Infinity },
};

const useCacheEntries = (globalThis.__VINEXT_USE_CACHE__ ??= new Map());
let scope = null; // the entry a "use cache" function is filling while it starts

function cacheKey(id, args) {
  try {
    return `${id}:${JSON.stringify(args)}`;
  } catch {
    return null; // arguments that cannot be keyed are not cached
  }
}

function fill(key, fn) {
  const entry = { life: PROFILES.default, tags: [], at: Date.now() };
  const prev = scope;
  scope = entry;
  let result;
  try {
    result = fn();
  } finally {
    scope = prev;
  }
  entry.value = Promise.resolve(result);
  if (key !== null) {
    useCacheEntries.set(key, entry);
    entry.value.catch(() => useCacheEntries.get(key) === entry && useCacheEntries.delete(key));
  }
  return entry.value;
}

/** Run a "use cache" function body, or answer its cached result. */
export function __vinext_useCache(id, args, fn) {
  const key = cacheKey(id, args);
  const hit = key !== null && useCacheEntries.get(key);
  if (hit) {
    const age = (Date.now() - hit.at) / 1000;
    if (age < hit.life.revalidate) return hit.value;
    if (age < hit.life.expire) {
      // Stale: answer it while a fresh result replaces it.
      if (!hit.refreshing) {
        hit.refreshing = true;
        fill(key, fn).catch(() => {});
      }
      return hit.value;
    }
  }
  return fill(key, fn);
}

export function cacheLife(profile) {
  if (!scope) return;
  scope.life = typeof profile === "string" ? PROFILES[profile] || PROFILES.default : { ...PROFILES.default, ...profile };
}

export function cacheTag(...tags) {
  if (scope) scope.tags.push(...tags);
}
export { cacheLife as unstable_cacheLife, cacheTag as unstable_cacheTag };
