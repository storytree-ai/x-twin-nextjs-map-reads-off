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

/** Mark fn as the inline "use cache" function id (keeping the name its wrapping hid). */
export function __vinext_cacheRef(id, fn, closure, name) {
  cacheRefs.set(fn, { id, closure });
  if (name && !fn.name) Object.defineProperty(fn, "name", { value: name, configurable: true });
  return fn;
}

class Unserializable extends Error {}
class Temporary extends Error {}
const SERVER_REFERENCE = Symbol.for("react.server.reference");
const CLIENT_REFERENCE = Symbol.for("react.client.reference");
const ELEMENTS = new Set([Symbol.for("react.transitional.element"), Symbol.for("react.element")]);

// A JSON.stringify replacer for the values a cached function closes over,
// which Next.js serializes as a server function's bound arguments: what React
// cannot pass (other functions, local symbols, class instances) is refused
// with React's words. Values JSON cannot tell apart get tagged objects, and a
// plain object with $-keys is tagged too, so no value keys as another.
// An object met again (round a cycle, or shared) keys as which one it was, in
// the order met, as React writes a reference to it. settled holds the promises met so
// far by what they came to; the ones not yet settled are pushed onto pending
// (and key as null for now). With temporary set (for arguments), a function
// or class instance makes the call unkeyable: Next.js passes them through as
// temporary references, unkeyed, which vinext does not swap back into a
// cached result (and keying them by identity would grow the cache with every
// request that makes a new one).
function boundReplacer(settled, pending, temporary = false) {
  const keying = new Set(); // the cached functions whose closed-over values are being keyed
  const met = new Map(); // the objects met so far, numbered in the order met
  return function boundValue(key, value) {
    const raw = this[key];
    if (raw && typeof raw === "object" && !(raw instanceof Date)) { // React writes a Date by value
      if (met.has(raw)) return { $ref: met.get(raw) };
      met.set(raw, met.size);
    }
    if (raw instanceof Date) return { $date: value };
    if (value === undefined) return { $undefined: true };
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) return { $number: Object.is(value, -0) ? "-0" : String(value) };
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
      if (temporary) throw new Temporary();
      throw new Unserializable(
        'Functions cannot be passed directly to Server Functions unless you explicitly expose it by marking it with "use server".',
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    if (ELEMENTS.has(value.$$typeof)) return { $element: elementType(value.type), key: value.key, props: value.props };
    if (value instanceof Promise) {
      if (settled.has(value)) return { $promise: settled.get(value) };
      pending.push(value);
      return null;
    }
    if (value instanceof Map) return { $map: [...value] };
    if (value instanceof Set) return { $set: [...value] };
    if (value instanceof ArrayBuffer) return { $bytes: [...new Uint8Array(value)] };
    if (ArrayBuffer.isView(value)) {
      return { $bytes: [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)], view: value.constructor.name };
    }
    if (value instanceof Error) return { $error: value.name, message: value.message };
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      if (temporary) throw new Temporary();
      throw new Unserializable(
        "Only plain objects, and a few built-ins, can be passed to Server Functions. Classes or null prototypes are not supported.",
      );
    }
    return Object.keys(value).some((k) => k[0] === "$") ? { $object: Object.entries(value) } : value;
  };
}

// Component types (functions, memo/forwardRef/context objects) by identity:
// they are made once per module, so a type keys alike across requests.
const typeIds = new WeakMap();
let nextTypeId = 0;

/** An element's type: a tag, a client reference's id, or a component by identity. */
function elementType(type) {
  if (typeof type === "string") return type;
  if (!type || (typeof type !== "object" && typeof type !== "function")) return String(type);
  if (type.$$id) return type.$$id;
  if (!typeIds.has(type)) typeIds.set(type, nextTypeId++);
  return `${type.displayName || type.name || ""}#${typeIds.get(type)}`;
}

/**
 * The entry's key: its id, its arguments and its closed-over values (a
 * promise of the key while promises among those are settling), or null when
 * it cannot be keyed.
 */
function cacheKey(id, args, closure, settled = new Map()) {
  const pending = [];
  const replacer = boundReplacer(settled, pending);
  let keyedArgs;
  try {
    keyedArgs = JSON.stringify(args, boundReplacer(settled, pending, true));
  } catch (err) {
    if (err instanceof Unserializable) throw new Error(`A "use cache" function (${id}) was passed an argument: ${err.message}`);
    return null; // arguments that cannot be keyed are not cached
  }
  let bound = "";
  for (const [name, value] of Object.entries(closure || {})) {
    try {
      bound += `:${JSON.stringify(value, replacer)}`;
    } catch (err) {
      if (err instanceof Unserializable) throw new Error(`A "use cache" function (${id}) reads ${name} from an enclosing function: ${err.message}`);
      return null;
    }
  }
  if (pending.length) {
    // A rejected one rejects the call, as React's encodeReply rejects.
    const settle = (p) => p.then((v) => settled.set(p, { value: v }));
    return Promise.all(pending.map(settle)).then(() => cacheKey(id, args, closure, settled));
  }
  return `${id}:${keyedArgs}${bound}`;
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
  return key instanceof Promise ? key.then((k) => cached(k, fn)) : cached(key, fn);
}

function cached(key, fn) {
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
