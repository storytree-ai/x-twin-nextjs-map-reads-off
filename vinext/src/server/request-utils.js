// Request helpers shared by page and API handling.

/** Search params as a Next.js query object (repeated keys become arrays). */
export function searchToQuery(searchParams) {
  const entries = new Map();
  for (const [k, v] of searchParams) {
    entries.set(k, entries.has(k) ? [].concat(entries.get(k), v) : v);
  }
  // fromEntries defines own properties, so keys like __proto__ stay data.
  return Object.fromEntries(entries);
}

/** Where to redirect a path with a trailing slash (Next.js strips them), or null. */
export function trailingSlashRedirect(pathname, search) {
  if (pathname.length <= 1 || !pathname.endsWith("/")) return null;
  // Collapse leading slashes/backslashes so the Location stays on this site
  // ("//evil.com/" must not become the protocol-relative "//evil.com").
  const target = pathname.replace(/\/+$/, "").replace(/^[/\\]+/, "/");
  return target + search;
}

/**
 * A Node request target as a URL. Origin-form targets ("/x") are joined, not
 * resolved, so "//host/x" stays a path; absolute-form ones ("http://h/x",
 * as proxies send) are parsed as they are.
 */
export function parseRequestTarget(target, host = "localhost") {
  const raw = target || "/";
  return /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`http://${host}${raw}`);
}
