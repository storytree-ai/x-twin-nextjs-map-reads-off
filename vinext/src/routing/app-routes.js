// File-system routes for the App Router: every app/ directory holding a
// page or route file is a route. Route groups "(name)" add no URL segment,
// "_private" folders and "@slot" folders are not routes of their own, and
// "%5F" in a folder name is a literal "_". Each route keeps its chain of
// levels (one per directory from app/ down) with the special files there.
import fs from "node:fs";
import path from "node:path";
import { parseSegment, sortRoutes, matchRoute, PAGE_EXTENSIONS } from "./pages-routes.js";

/** File conventions a directory level may hold. */
const LEVEL_FILES = {
  layout: "layout",
  template: "template",
  "not-found": "notFound",
  error: "error",
  loading: "loading",
  "global-error": "globalError",
  forbidden: "forbidden",
  unauthorized: "unauthorized",
};

function findFile(files, base) {
  for (const ext of PAGE_EXTENSIONS) if (files.has(base + ext)) return base + ext;
  return null;
}

/** The URL segment a directory name contributes, or null for none. */
function urlSegment(name) {
  if (/^\(.*\)$/.test(name)) return null; // route group
  return name.replace(/%5F/gi, "_");
}

function isRoutable(name) {
  return !name.startsWith("_") && !name.startsWith("@") && !name.startsWith("(.") && name !== "node_modules";
}

function scanDir(dir, segments, levels, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const level = { dir, paramNames: segments.filter((s) => s.type !== "static").map((s) => s.name) };
  for (const [base, key] of Object.entries(LEVEL_FILES)) {
    const f = findFile(files, base);
    level[key] = f ? path.join(dir, f) : null;
  }
  const chain = [...levels, level];
  const pattern = "/" + segments.map((s) => (s.type === "static" ? s.value : s.raw)).join("/");
  const page = findFile(files, "page");
  const handler = findFile(files, "route");
  if (page || handler) {
    out.push({
      pattern,
      kind: page ? "page" : "route",
      file: path.join(dir, page || handler),
      segments,
      levels: chain,
    });
  }
  for (const e of entries) {
    if (!e.isDirectory() || !isRoutable(e.name)) continue;
    const seg = urlSegment(e.name);
    const next = seg === null ? segments : [...segments, { ...parseSegment(seg), raw: seg }];
    scanDir(path.join(dir, e.name), next, chain, out);
  }
  return level;
}

/** Scan app/: the routes sorted most specific first, and app/'s own level. */
export function scanAppDir(appDir) {
  const routes = [];
  const root = scanDir(appDir, [], [], routes);
  return { routes: sortRoutes(routes), root };
}

/** The first route matching pathname, with its params, or null. */
export function matchAppRoute(routes, pathname) {
  return matchRoute(routes, pathname);
}
