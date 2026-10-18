// next/server: NextRequest / NextResponse over the Fetch API, plus after()
// and connection(). The dev server runs middleware (server/middleware.js).
class RequestCookies {
  constructor(headers) {
    this._headers = headers;
    this._map = new Map();
    for (const part of (headers.get("cookie") || "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0) this._map.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
    }
  }
  get(name) {
    return this._map.has(name) ? { name, value: this._map.get(name) } : undefined;
  }
  getAll() {
    return [...this._map].map(([name, value]) => ({ name, value }));
  }
  has(name) {
    return this._map.has(name);
  }
  set(name, value) {
    this._map.set(name, String(value));
    this._sync();
    return this;
  }
  delete(name) {
    const had = this._map.delete(name);
    this._sync();
    return had;
  }
  _sync() {
    this._headers.set("cookie", [...this._map].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; "));
  }
}

class ResponseCookies {
  constructor(headers) {
    this._headers = headers;
    this._map = new Map();
  }
  get(name) {
    return this._map.get(name);
  }
  getAll() {
    return [...this._map.values()];
  }
  has(name) {
    return this._map.has(name);
  }
  set(name, value, options = {}) {
    const cookie = typeof name === "object" ? name : { name, value, ...options };
    this._map.set(cookie.name, cookie);
    this._sync();
    return this;
  }
  delete(name) {
    return this.set(name, "", { expires: new Date(0), path: "/" });
  }
  _sync() {
    this._headers.delete("set-cookie");
    for (const c of this._map.values()) {
      let s = `${c.name}=${encodeURIComponent(c.value ?? "")}`;
      if (c.path) s += `; Path=${c.path}`;
      if (c.domain) s += `; Domain=${c.domain}`;
      if (c.maxAge !== undefined) s += `; Max-Age=${c.maxAge}`;
      if (c.expires) s += `; Expires=${new Date(c.expires).toUTCString()}`;
      if (c.httpOnly) s += "; HttpOnly";
      if (c.secure) s += "; Secure";
      if (c.sameSite) s += `; SameSite=${c.sameSite}`;
      this._headers.append("set-cookie", s);
    }
  }
}

/**
 * NextResponse.next({ request: { headers } }) replaces the request headers
 * the page sees: the list goes in x-middleware-override-headers, each value
 * in x-middleware-request-<name>, as in Next.js.
 */
function overrideRequestHeaders(responseHeaders, request) {
  if (!request || !request.headers) return;
  const headers = new Headers(request.headers);
  const names = [];
  for (const [name, value] of headers) {
    names.push(name);
    responseHeaders.set(`x-middleware-request-${name}`, value);
  }
  responseHeaders.set("x-middleware-override-headers", names.join(","));
}

export class NextURL extends URL {
  clone() {
    return new NextURL(this.href);
  }
}

export class NextRequest extends Request {
  constructor(input, init) {
    super(input, init);
    this._cookies = new RequestCookies(this.headers);
    this._nextUrl = new NextURL(this.url);
  }
  get nextUrl() {
    return this._nextUrl;
  }
  get cookies() {
    return this._cookies;
  }
}

export class NextResponse extends Response {
  constructor(body, init) {
    super(body, init);
    this._cookies = new ResponseCookies(this.headers);
  }
  get cookies() {
    return this._cookies;
  }
  static json(body, init) {
    const res = Response.json(body, init);
    return new NextResponse(res.body, res);
  }
  static redirect(url, init) {
    const status = typeof init === "number" ? init : (init && init.status) || 307;
    const headers = new Headers(typeof init === "object" ? init.headers : undefined);
    headers.set("location", String(url));
    return new NextResponse(null, { status, headers });
  }
  static rewrite(destination, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-middleware-rewrite", String(destination));
    overrideRequestHeaders(headers, init.request);
    return new NextResponse(null, { ...init, headers });
  }
  static next(init = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-middleware-next", "1");
    overrideRequestHeaders(headers, init.request);
    return new NextResponse(null, { ...init, headers });
  }
}

export function userAgentFromString(ua) {
  const s = ua || "";
  return {
    ua: s,
    isBot: /bot|crawler|spider|crawling/i.test(s),
    browser: {},
    device: {},
    engine: {},
    os: {},
    cpu: {},
  };
}

export function userAgent(req) {
  return userAgentFromString(req.headers.get("user-agent") || undefined);
}

export function after(task) {
  const run = typeof task === "function" ? () => task() : () => task;
  setTimeout(() => {
    Promise.resolve()
      .then(run)
      .catch((err) => console.error(err));
  }, 0);
}

export async function connection() {}
