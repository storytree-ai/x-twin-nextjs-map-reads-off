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
  default: "default",
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

function scanDir(dir, segments, levels, out, name = "") {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const level = {
    dir,
    segment: name,
    depth: segments.length,
    paramNames: segments.filter((s) => s.type !== "static").map((s) => s.name),
    slots: entries
      .filter((e) => e.isDirectory() && e.name.startsWith("@"))
      .map((e) => ({ name: e.name.slice(1), dir: path.join(dir, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  for (const [base, key] of Object.entries(LEVEL_FILES)) {
    const f = findFile(files, base);
    level[key] = f ? path.join(dir, f) : null;
  }
  const chain = [...levels, level];
  const pattern = patternOf(segments);
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
    scanDir(path.join(dir, e.name), next, chain, out, e.name);
  }
  return level;
}

const patternOf = (segments) => "/" + segments.map((s) => (s.type === "static" ? s.value : s.raw)).join("/");

/** A slot's pages, by their pattern relative to the slot, and its root level. */
function scanSlot(slot) {
  const pages = [];
  const root = scanDir(slot.dir, [], [], pages, "@" + slot.name);
  return { root, pages: pages.filter((p) => p.kind === "page") };
}

/**
 * What each @slot along a route renders: { [levelIndex]: [{ name, file,
 * levels }] } with the slot's page for the rest of the URL, else its
 * default.tsx (a slot with neither renders nothing).
 */
function assignSlots(route, slotScans) {
  const out = {};
  route.levels.forEach((level, i) => {
    if (!level.slots.length) return;
    const rest = patternOf(route.segments.slice(level.depth));
    const list = [];
    for (const slot of level.slots) {
      const scan = slotScans.get(slot.dir);
      const page = scan.pages.find((p) => p.pattern === rest);
      if (page) list.push({ name: slot.name, file: page.file, levels: page.levels });
      else if (scan.root && scan.root.default) list.push({ name: slot.name, file: scan.root.default, levels: [scan.root] });
    }
    if (list.length) out[i] = list;
  });
  return out;
}

/** Scan app/: the routes sorted most specific first, and app/'s own level. */
export function scanAppDir(appDir) {
  const routes = [];
  const root = scanDir(appDir, [], [], routes);
  const slotScans = new Map();
  const levels = new Set(routes.flatMap((r) => r.levels));
  for (const level of levels) for (const slot of level.slots) slotScans.set(slot.dir, scanSlot(slot));
  // URLs only a slot has: the level's default.tsx renders as their children.
  const patterns = new Set(routes.map((r) => r.pattern));
  for (const r of [...routes]) {
    const level = r.levels[r.levels.length - 1];
    if (r.kind !== "page" || !level.default) continue;
    for (const slot of level.slots) {
      for (const p of slotScans.get(slot.dir).pages) {
        const segments = [...r.segments, ...p.segments];
        const pattern = patternOf(segments);
        if (p.segments.length === 0 || patterns.has(pattern)) continue;
        patterns.add(pattern);
        routes.push({ pattern, kind: "page", file: level.default, segments, levels: r.levels });
      }
    }
  }
  for (const r of routes) r.slots = assignSlots(r, slotScans);
  return { routes: sortRoutes(routes), root };
}

/** The first route matching pathname, with its params, or null. */
export function matchAppRoute(routes, pathname) {
  return matchRoute(routes, pathname);
}

const ICON_FILES = [
  { base: "favicon", exts: [".ico"], rel: "icon" },
  { base: "icon", exts: [".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg"], rel: "icon" },
  { base: "apple-icon", exts: [".png", ".jpg", ".jpeg"], rel: "apple-touch-icon" },
];
const ICON_TYPES = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/** "WxH" of a .ico / .png / .gif file from its header, or null. */
export function imageSize(buf, ext) {
  try {
    if (ext === ".ico" && buf.length >= 8) return `${buf[6] || 256}x${buf[7] || 256}`;
    if (ext === ".png" && buf.length >= 24) return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
    if (ext === ".gif" && buf.length >= 10) return `${buf.readUInt16LE(6)}x${buf.readUInt16LE(8)}`;
  } catch {}
  return ext === ".svg" ? "any" : null;
}

/** Metadata routes at app/'s root, by URL: robots.txt, sitemap.xml, manifest. */
const METADATA_ROUTES = [
  { base: "robots", path: "/robots.txt", type: "robots" },
  { base: "sitemap", path: "/sitemap.xml", type: "sitemap" },
  { base: "manifest", path: "/manifest.webmanifest", type: "manifest" },
];

/**
 * app/'s root metadata files: the <link> props its static icon files add to
 * every page, and its robots/sitemap/manifest modules.
 */
export function scanMetadataFiles(appDir) {
  let files;
  try {
    files = new Set(fs.readdirSync(appDir));
  } catch {
    return { icons: [], routes: [] };
  }
  const icons = [];
  for (const { base, exts, rel } of ICON_FILES) {
    for (const ext of exts) {
      if (!files.has(base + ext)) continue;
      const props = { rel, href: `/${base}${ext}`, type: ICON_TYPES[ext] };
      const sizes = imageSize(fs.readFileSync(path.join(appDir, base + ext)), ext);
      if (sizes) props.sizes = sizes;
      icons.push(props);
      break;
    }
  }
  const routes = [];
  for (const r of METADATA_ROUTES) {
    const f = findFile(files, r.base);
    if (f) routes.push({ path: r.path, type: r.type, file: path.join(appDir, f) });
  }
  return { icons, routes };
}
