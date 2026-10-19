// next/headers: the request's headers and cookies. The App Router renders
// each request inside the dev server's per-request store (see
// server/ssr-context.js); cookies().set/delete there become Set-Cookie
// headers on the response.

function requestStore() {
  const als = globalThis.__VINEXT_SSR_ALS__;
  const store = als && als.getStore();
  return store && store.appRequest;
}

let fallbackHeaders = new Headers();

export function _setRequestHeaders(h) {
  fallbackHeaders = h instanceof Headers ? h : new Headers(h || {});
}

function parseCookies(header) {
  const map = new Map();
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const raw = part.slice(i + 1).trim();
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {}
    map.set(part.slice(0, i).trim(), value);
  }
  return map;
}

/** A Set-Cookie header value for { name, value, ...options }. */
export function serializeCookie(c) {
  let s = `${c.name}=${encodeURIComponent(c.value ?? "")}`;
  if (c.path) s += `; Path=${c.path}`;
  if (c.domain) s += `; Domain=${c.domain}`;
  if (c.maxAge !== undefined) s += `; Max-Age=${c.maxAge}`;
  if (c.expires !== undefined) s += `; Expires=${new Date(c.expires).toUTCString()}`;
  if (c.httpOnly) s += "; HttpOnly";
  if (c.secure) s += "; Secure";
  if (c.sameSite) s += `; SameSite=${typeof c.sameSite === "string" ? c.sameSite : "Strict"}`;
  if (c.partitioned) s += "; Partitioned";
  if (c.priority) s += `; Priority=${c.priority}`;
  return s;
}

const READONLY_HEADERS = "Headers cannot be modified. Read more: https://nextjs.org/docs/app/api-reference/functions/headers";

function readonlyHeaders(source) {
  const h = new Headers(source);
  const deny = () => {
    throw new Error(READONLY_HEADERS);
  };
  h.set = deny;
  h.append = deny;
  h.delete = deny;
  return h;
}

const HEADERS_METHODS = ["get", "has", "getSetCookie", "entries", "keys", "values", "forEach", Symbol.iterator, "set", "append", "delete"];

/**
 * A Promise of headers that is also usable as the headers themselves, as
 * Next.js's request APIs still are in dev: its methods and iteration read
 * the awaited object.
 */
function exoticHeaders(h) {
  const promise = Promise.resolve(h);
  for (const key of HEADERS_METHODS) {
    Object.defineProperty(promise, key, { value: (...args) => h[key](...args) });
  }
  return promise;
}

/** Under `dynamic = "error"` a request API refuses, as Next.js's StaticGenBailoutError does. */
function assertDynamicAllowed(store, expression) {
  if (store && store.dynamicShouldError) {
    throw new Error(
      `Route ${store.route} with \`dynamic = "error"\` couldn't be rendered statically because it used \`${expression}\`. See more info here: https://nextjs.org/docs/app/building-your-application/rendering/static-and-dynamic#dynamic-rendering`,
    );
  }
}

export function headers() {
  const store = requestStore();
  if (!store) return exoticHeaders(fallbackHeaders);
  assertDynamicAllowed(store, "headers()");
  store.dynamicUsed = true;
  return exoticHeaders((store.readonlyHeaders ??= readonlyHeaders(store.headers)));
}

const READONLY_COOKIES =
  "Cookies can only be modified in a Server Action or Route Handler. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options";

function cookieStore(store) {
  const map = store ? store.cookies : parseCookies(fallbackHeaders.get("cookie"));
  // While a page renders (phase "render") cookies are read-only.
  const assertWritable = () => {
    if (store && store.phase === "render") throw new Error(READONLY_COOKIES);
  };
  const set = (name, value, options) => {
    assertWritable();
    const c = typeof name === "object" ? { ...name } : { name, value, ...options };
    c.value = String(c.value ?? "");
    map.set(c.name, c.value);
    if (store) store.setCookies.set(c.name, c);
  };
  const api = {
    get: (name) => {
      const key = typeof name === "object" ? name.name : name;
      return map.has(key) ? { name: key, value: map.get(key) } : undefined;
    },
    getAll: (name) => [...map].filter(([k]) => !name || k === name).map(([n, value]) => ({ name: n, value })),
    has: (name) => map.has(name),
    get size() {
      return map.size;
    },
    set(name, value, options) {
      set(name, value, options);
      return api;
    },
    delete(name) {
      assertWritable();
      const opts = typeof name === "object" ? name : { name };
      map.delete(opts.name);
      if (store) store.setCookies.set(opts.name, { path: "/", ...opts, value: "", expires: 0 });
      return api;
    },
    toString: () => [...map].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "),
    [Symbol.iterator]: () => api.getAll().map((c) => [c.name, c])[Symbol.iterator](),
  };
  return api;
}

/** A Promise of value that also has value's own API, as Next.js 15's request APIs do. */
function syncThenable(value) {
  const promise = Promise.resolve(value);
  for (const key of Reflect.ownKeys(value)) {
    Object.defineProperty(promise, key, { get: () => value[key], enumerable: true });
  }
  return promise;
}

export function cookies() {
  const store = requestStore();
  assertDynamicAllowed(store, "cookies()");
  if (store) store.dynamicUsed = true;
  return syncThenable(cookieStore(store));
}

/** The per-request state headers()/cookies() read, for the App Router. */
export function createAppRequestStore(requestHeaders) {
  const h = requestHeaders instanceof Headers ? requestHeaders : new Headers(requestHeaders || {});
  return { headers: h, cookies: parseCookies(h.get("cookie")), setCookies: new Map() };
}

/** The Set-Cookie header values a request's cookies().set/delete produced. */
export function takeSetCookies(store) {
  const out = [...store.setCookies.values()].map(serializeCookie);
  store.setCookies.clear();
  return out;
}

export function draftMode() {
  assertDynamicAllowed(requestStore(), "draftMode()");
  return syncThenable({ isEnabled: false, enable() {}, disable() {} });
}
