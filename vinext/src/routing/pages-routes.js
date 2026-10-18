// File-system routes for the Pages Router: pages/ files become route
// patterns (/posts/[id], /docs/[...slug], /x/[[...rest]]), sorted the way
// Next.js prefers them, and matched against request pathnames.
import fs from "node:fs";
import path from "node:path";

export const PAGE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];

const SPECIAL_PAGES = new Set(["/_app", "/_document", "/_error"]);

/** Parse one route segment: static, [param], [...param] or [[...param]]. */
export function parseSegment(segment) {
  let m = /^\[\[\.\.\.([^\]]+)\]\]$/.exec(segment);
  if (m) return { type: "optional-catch-all", name: m[1] };
  m = /^\[\.\.\.([^\]]+)\]$/.exec(segment);
  if (m) return { type: "catch-all", name: m[1] };
  m = /^\[([^\]]+)\]$/.exec(segment);
  if (m) return { type: "dynamic", name: m[1] };
  return { type: "static", value: segment };
}

/** A route for a file path relative to pages/ (e.g. "posts/[id].tsx"). */
export function fileToRoute(relFile, absFile) {
  const noExt = relFile.replace(/\\/g, "/").replace(/\.[^./]+$/, "");
  const parts = noExt.split("/");
  if (parts[parts.length - 1] === "index") parts.pop();
  const pattern = "/" + parts.join("/");
  return {
    pattern,
    file: absFile,
    segments: parts.map(parseSegment),
    isApi: parts[0] === "api",
  };
}

const RANK = { static: 0, dynamic: 1, "catch-all": 2, "optional-catch-all": 3 };

/** Most specific first: static segments beat params, params beat catch-alls. */
export function sortRoutes(routes) {
  return [...routes].sort((a, b) => {
    const n = Math.max(a.segments.length, b.segments.length);
    for (let i = 0; i < n; i++) {
      const sa = a.segments[i];
      const sb = b.segments[i];
      if (!sa) return -1;
      if (!sb) return 1;
      if (RANK[sa.type] !== RANK[sb.type]) return RANK[sa.type] - RANK[sb.type];
    }
    return a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0;
  });
}

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The first route matching a pathname, with its params, or null. */
export function matchRoute(routes, pathname) {
  const parts = pathname.split("/").filter(Boolean).map(decode);
  for (const route of routes) {
    const params = matchSegments(route.segments, parts);
    if (params) return { route, params };
  }
  return null;
}

function matchSegments(segments, parts) {
  const params = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === "catch-all" || seg.type === "optional-catch-all") {
      const rest = parts.slice(i);
      if (rest.length === 0 && seg.type === "catch-all") return null;
      if (rest.length > 0) params[seg.name] = rest;
      return params;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (seg.type === "static") {
      if (seg.value !== part) return null;
    } else {
      params[seg.name] = part;
    }
  }
  return parts.length === segments.length ? params : null;
}

function walk(dir, base, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") walk(abs, rel, out);
    } else if (PAGE_EXTENSIONS.includes(path.extname(entry.name)) && !entry.name.endsWith(".d.ts")) {
      out.push({ rel, abs });
    }
  }
  return out;
}

/**
 * Scan a pages/ directory. Returns the sorted page and API routes plus the
 * special files (_app, _document, 404, _error) when present.
 */
export function scanPagesDir(pagesDir) {
  const routes = [];
  const special = {};
  for (const { rel, abs } of walk(pagesDir, "", [])) {
    const route = fileToRoute(rel, abs);
    if (SPECIAL_PAGES.has(route.pattern)) {
      special[route.pattern.slice(2)] = abs; // "/_app" → "app"
      continue;
    }
    if (route.pattern === "/404" || route.pattern === "/500") special[route.pattern.slice(1)] = abs;
    routes.push(route);
  }
  const sorted = sortRoutes(routes);
  return {
    pages: sorted.filter((r) => !r.isApi),
    api: sorted.filter((r) => r.isApi),
    special,
  };
}
