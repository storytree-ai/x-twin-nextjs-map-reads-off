// next/cache: unstable_cache memoizes data in memory (by key parts and
// arguments, expiring after `revalidate` seconds, dropped by revalidateTag);
// revalidatePath / revalidateTag also mark the current request as
// revalidated, so a server action re-renders the page it was called from.
// "use cache" functions run through __vinext_useCache (see
// plugins/use-cache.js): their results are kept per arguments for their
// cacheLife profile and dropped by revalidateTag of a cacheTag they set;
// the values they close over key them too.

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
let scope = null; // the entry a "use cache" function is filling, without async context
// The entry a "use cache" function is filling, across its awaits (an
// AsyncLocalStorage made from the server's own, as this module also loads
// where node:async_hooks cannot be imported).
let cacheAls;
function cacheContext() {
  if (!cacheAls) {
    const Als = globalThis.__VINEXT_SSR_ALS__ && globalThis.__VINEXT_SSR_ALS__.constructor;
    if (Als) cacheAls = new Als();
  }
  return cacheAls || null;
}
const currentEntry = () => (cacheContext() && cacheContext().getStore()) || scope;

// Inline "use cache" functions (marked where they are made), by value: their
// id and a getter for the values they close over.
const cacheRefs = new WeakMap();

/** Mark fn as the inline "use cache" function id. */
export function __vinext_cacheRef(id, fn, closure) {
  cacheRefs.set(fn, { id, closure });
  return fn;
}

class Unserializable extends Error {}
const SERVER_REFERENCE = Symbol.for("react.server.reference");
const CLIENT_REFERENCE = Symbol.for("react.client.reference");
const keying = new Set(); // the cached functions whose closed-over values are being keyed
const ELEMENTS = new Set([Symbol.for("react.transitional.element"), Symbol.for("react.element")]);

// A JSON.stringify replacer for the values a cached function closes over,
// which Next.js serializes as a server function's bound arguments: what React
// cannot pass (other functions, local symbols, class instances) is refused
// with React's words.
function boundValue(key, value) {
  if (typeof value === "bigint") return { $bigint: String(value) };
  if (typeof value === "symbol") {
    const name = Symbol.keyFor(value);
    if (name === undefined) {
      throw new Unserializable(
        `Only global symbols received from Symbol.for(...) can be passed to Server Functions. The symbol ${String(value)} cannot be found among global symbols.`,
      );
    }
    return { $symbol: name };
  }
  if (typeof value === "function") {
    if (value.$$typeof === SERVER_REFERENCE) return { $action: value.$$id, bound: value.$$bound ?? null };
    if (value.$$typeof === CLIENT_REFERENCE) return { $client: value.$$id };
    const ref = cacheRefs.get(value);
    if (ref) {
      // Its own closed-over values, once round a loop of functions reading each other.
      if (!ref.closure || keying.has(value)) return { $cache: ref.id };
      keying.add(value);
      try {
        return { $cache: ref.id, bound: JSON.stringify(ref.closure(), boundValue) };
      } finally {
        keying.delete(value);
      }
    }
    throw new Unserializable(
      'Functions cannot be passed directly to Server Functions unless you explicitly expose it by marking it with "use server".',
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (ELEMENTS.has(value.$$typeof)) {
    const { type } = value;
    const name = typeof type === "string" ? type : typeof type === "symbol" ? String(type) : type.$$id || type.displayName || type.name;
    return { $element: name, key: value.key, props: value.props };
  }
  if (value instanceof Map) return { $map: [...value] };
  if (value instanceof Set) return { $set: [...value] };
  if (value instanceof ArrayBuffer) return { $bytes: [...new Uint8Array(value)] };
  if (ArrayBuffer.isView(value)) {
    return { $bytes: [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)], view: value.constructor.name };
  }
  if (value instanceof Error) return { $error: value.name, message: value.message };
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && !(value instanceof Promise)) {
    throw new Unserializable(
      "Only plain objects, and a few built-ins, can be passed to Server Functions. Classes or null prototypes are not supported.",
    );
  }
  return value;
}

function cacheKey(id, args, closure) {
  let bound = "";
  for (const [name, value] of Object.entries(closure || {})) {
    try {
      bound += `:${JSON.stringify(value, boundValue)}`;
    } catch (err) {
      if (err instanceof Unserializable) throw new Error(`A "use cache" function (${id}) reads ${name} from an enclosing function: ${err.message}`);
      return null;
    }
  }
  try {
    return `${id}:${JSON.stringify(args)}${bound}`;
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
    result = cacheContext() ? cacheContext().run(entry, fn) : fn();
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
export function __vinext_useCache(id, args, fn, closure) {
  let key;
  try {
    key = cacheKey(id, args, closure);
  } catch (err) {
    return Promise.reject(err);
  }
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
  const entry = currentEntry();
  if (!entry) return;
  entry.life = typeof profile === "string" ? PROFILES[profile] || PROFILES.default : { ...PROFILES.default, ...profile };
}

export function cacheTag(...tags) {
  const entry = currentEntry();
  if (entry) entry.tags.push(...tags);
}
export { cacheLife as unstable_cacheLife, cacheTag as unstable_cacheTag };
