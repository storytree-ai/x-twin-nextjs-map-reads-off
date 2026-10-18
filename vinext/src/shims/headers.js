// next/headers: request headers and cookies (filled by the App Router).
let requestHeaders = new Headers();

export function _setRequestHeaders(h) {
  requestHeaders = h instanceof Headers ? h : new Headers(h || {});
}

function parseCookies(header) {
  const map = new Map();
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) map.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return map;
}

export async function headers() {
  return requestHeaders;
}

export async function cookies() {
  const map = parseCookies(requestHeaders.get("cookie"));
  return {
    get: (name) => (map.has(name) ? { name, value: map.get(name) } : undefined),
    getAll: () => [...map].map(([name, value]) => ({ name, value })),
    has: (name) => map.has(name),
    set() {},
    delete() {},
    toString: () => requestHeaders.get("cookie") || "",
  };
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}
