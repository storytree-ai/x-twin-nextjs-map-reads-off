// next.config redirects(), rewrites() and headers(): loaded once per server
// and applied in the order Next.js documents (headers, redirects,
// middleware, beforeFiles rewrites, files, afterFiles, dynamic routes,
// fallback).
import { matchPath, fillDestination, matchConditions } from "../routing/path-match.js";

/** Resolve the config's rule functions into plain lists. */
export async function loadRules(config = {}) {
  const call = async (fn) => (typeof fn === "function" ? (await fn()) || [] : []);
  const rewrites = await call(config.rewrites);
  return {
    headers: await call(config.headers),
    redirects: await call(config.redirects),
    rewrites: Array.isArray(rewrites)
      ? { beforeFiles: [], afterFiles: rewrites, fallback: [] }
      : {
          beforeFiles: rewrites.beforeFiles || [],
          afterFiles: rewrites.afterFiles || [],
          fallback: rewrites.fallback || [],
        },
  };
}

/** Params when a rule matches the pathname and its has/missing hold, else null. */
function matchRule(rule, pathname, req) {
  const params = matchPath(rule.source, pathname);
  if (!params) return null;
  const conditions = matchConditions(rule.has, rule.missing, req);
  if (!conditions) return null;
  return { ...params, ...conditions };
}

export function collectHeaders(rules, pathname, req) {
  const out = [];
  for (const rule of rules) {
    const params = matchRule(rule, pathname, req);
    if (!params) continue;
    for (const h of rule.headers || []) {
      out.push({ key: h.key, value: fillDestination(h.value, params) });
    }
  }
  return out;
}

/** { location, status } for the first matching redirect, or null. */
export function findRedirect(rules, pathname, search, req) {
  for (const rule of rules) {
    const params = matchRule(rule, pathname, req);
    if (!params) continue;
    let location = fillDestination(rule.destination, params);
    if (search && search !== "?") {
      // The request's query carries over, behind the destination's own.
      const [base, hash] = location.split("#");
      location = base + (base.includes("?") ? "&" : "?") + search.replace(/^\?/, "") + (hash ? `#${hash}` : "");
    }
    const status = rule.statusCode || (rule.permanent ? 308 : 307);
    return { location, status };
  }
  return null;
}

/**
 * The first matching rewrite: { pathname, query, external } where query is
 * the destination's own search params and external a full URL for
 * rewrites off this server.
 */
export function findRewrite(rules, pathname, req) {
  for (const rule of rules) {
    const params = matchRule(rule, pathname, req);
    if (!params) continue;
    const dest = fillDestination(rule.destination, params);
    if (/^https?:\/\//.test(dest)) return { pathname: null, query: {}, external: dest };
    const url = new URL(dest, "http://localhost");
    const query = {};
    for (const [k, v] of url.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
    return { pathname: url.pathname, query, external: null };
  }
  return null;
}
