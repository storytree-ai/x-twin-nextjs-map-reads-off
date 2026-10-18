// path-to-regexp style sources, as next.config redirects/rewrites/headers
// and the middleware matcher write them: "/blog/:slug", "/docs/:path*",
// "/api/(.*)", "/((?!api|_next).*)". Plus the has/missing conditions those
// rules carry.

const cache = new Map();

/** Read a balanced "(…)" group starting at source[i] === "(". */
function readGroup(source, i) {
  let depth = 0;
  let inClass = false;
  for (let j = i; j < source.length; j++) {
    const c = source[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return { body: source.slice(i + 1, j), end: j + 1 };
  }
  throw new Error(`Unbalanced group in route source "${source}"`);
}

const escapeRe = (s) => s.replace(/[.+*?^${}()[\]|\\/]/g, "\\$&");

/** Compile a source into { regex, keys }; keys are param names or group indexes. */
export function compilePath(source) {
  if (cache.has(source)) return cache.get(source);
  const keys = [];
  let re = "";
  let unnamed = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    let name = null;
    let pattern = null;
    if (c === ":") {
      const m = /^:([A-Za-z0-9_]+)/.exec(source.slice(i));
      if (m) {
        name = m[1];
        i += m[0].length;
        if (source[i] === "(") {
          const g = readGroup(source, i);
          pattern = g.body;
          i = g.end;
        }
      }
    } else if (c === "(") {
      const g = readGroup(source, i);
      name = unnamed++;
      pattern = g.body;
      i = g.end;
    } else if (c === "\\" && i + 1 < source.length) {
      re += escapeRe(source[i + 1]);
      i += 2;
      continue;
    }
    if (name === null) {
      re += escapeRe(c);
      i++;
      continue;
    }
    const modifier = source[i] && "?*+".includes(source[i]) ? source[i++] : "";
    const segment = pattern ?? "[^/#?]+?";
    keys.push(name);
    // A modified param swallows the "/" before it, as path-to-regexp does.
    const prefix = re.endsWith("\\/") ? "\\/" : "";
    if (prefix && modifier) re = re.slice(0, -2);
    if (modifier === "*" || modifier === "+") {
      const body = `(${pattern ? segment : `${segment}(?:\\/${segment})*`})`;
      re += `(?:${prefix}${body})${modifier === "*" ? "?" : ""}`;
    } else if (modifier === "?") {
      re += `(?:${prefix}(${segment}))?`;
    } else {
      re += `(${segment})`;
    }
  }
  const compiled = { regex: new RegExp(`^${re}(?:\\/)?$`, "i"), keys };
  cache.set(source, compiled);
  return compiled;
}

function decode(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Params for pathname against source, or null when it does not match. */
export function matchPath(source, pathname) {
  const { regex, keys } = compilePath(source);
  const m = regex.exec(pathname);
  if (!m) return null;
  const params = {};
  keys.forEach((k, idx) => {
    params[k] = m[idx + 1] === undefined ? undefined : decode(m[idx + 1]);
  });
  return params;
}

/** Substitute :params into a destination (path, query and hash). */
export function fillDestination(destination, params) {
  const qIndex = destination.search(/[?#]/);
  const path = qIndex === -1 ? destination : destination.slice(0, qIndex);
  const rest = qIndex === -1 ? "" : destination.slice(qIndex);
  const sub = (str, enc) =>
    str.replace(/:([A-Za-z0-9_]+)(\*|\+|\?)?/g, (m, name) => {
      if (!(name in params)) return m;
      const v = params[name];
      if (v === undefined) return "";
      return Array.isArray(v) ? v.map(enc).join("/") : enc(String(v));
    });
  // Path params keep their "/" (catch-alls); query values are encoded whole.
  const encPath = (v) => String(v).split("/").map(encodeURIComponent).join("/");
  let out = sub(path, encPath) + sub(rest, encodeURIComponent);
  if (/^https?:\/\//.test(destination)) return out;
  out = out.replace(/\/{2,}/g, "/");
  return out.length > 1 && out.endsWith("/") && !destination.endsWith("/") ? out.slice(0, -1) : out;
}

function parseCookieHeader(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      const k = part.slice(0, i).trim();
      if (!Object.hasOwn(out, k)) out[k] = decode(part.slice(i + 1).trim());
    }
  }
  return out;
}

function conditionValue(cond, req) {
  const headers = req.headers || {};
  switch (cond.type) {
    case "header": {
      const v = headers[cond.key.toLowerCase()];
      return Array.isArray(v) ? v.join(", ") : v;
    }
    case "cookie":
      return parseCookieHeader(headers.cookie)[cond.key];
    case "query": {
      const v = (req.query || {})[cond.key];
      return Array.isArray(v) ? v[v.length - 1] : v;
    }
    case "host":
      return String(headers.host || "").replace(/:\d+$/, "");
    default:
      return undefined;
  }
}

/** Does one condition hold? Returns its captured params, or null. */
function testCondition(cond, req) {
  const value = conditionValue(cond, req);
  if (value === undefined || value === null) return null;
  const expected = cond.value;
  if (expected === undefined) {
    return cond.type === "host" ? null : { [cond.key.replace(/[^A-Za-z0-9_]/g, "")]: value };
  }
  const m = new RegExp(`^(?:${expected})$`).exec(String(value));
  if (!m) return null;
  const params = { ...(m.groups || {}) };
  if (cond.key) params[cond.key.replace(/[^A-Za-z0-9_]/g, "")] = m[0];
  return params;
}

/**
 * Check a rule's has/missing lists against a request ({ headers, query }).
 * Returns the params captured by `has` (an object, possibly empty), or null.
 */
export function matchConditions(has, missing, req) {
  const params = {};
  for (const cond of has || []) {
    const p = testCondition(cond, req);
    if (!p) return null;
    Object.assign(params, p);
  }
  for (const cond of missing || []) {
    if (testCondition(cond, req)) return null;
  }
  return params;
}
