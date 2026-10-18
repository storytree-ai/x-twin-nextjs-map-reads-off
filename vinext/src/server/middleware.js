// middleware.ts in `vinext dev`: find it, decide whether its matcher selects
// a path, run it on a NextRequest and read what it answered.
import fs from "node:fs";
import path from "node:path";
import { matchPath, matchConditions } from "../routing/path-match.js";
import { shimPath } from "../shims/index.js";

const NAMES = ["middleware", "proxy"];
const EXTS = [".ts", ".js", ".mjs", ".tsx", ".jsx", ".mts"];

export function findMiddleware(root) {
  for (const dir of [root, path.join(root, "src")]) {
    for (const name of NAMES) {
      for (const ext of EXTS) {
        const file = path.join(dir, name + ext);
        if (fs.existsSync(file)) return file;
      }
    }
  }
  return null;
}

/** Does the middleware's `config.matcher` select pathname for this request? */
export function middlewareMatches(config, pathname, req) {
  const matcher = config && config.matcher;
  if (!matcher) return true;
  for (const m of [].concat(matcher)) {
    const source = typeof m === "string" ? m : m && m.source;
    if (!source || !matchPath(source, pathname)) continue;
    if (typeof m === "object" && !matchConditions(m.has, m.missing, req)) continue;
    return true;
  }
  return false;
}

const INTERNAL = /^x-middleware-/;
// Framing headers describe the middleware's own (empty) body, not the page's.
const FRAMING = new Set(["content-length", "transfer-encoding", "connection", "content-encoding"]);

/**
 * What the middleware answered:
 *   { type: "next", headers, requestHeaders }      carry on (headers go on the response)
 *   { type: "rewrite", url, headers, requestHeaders, status }  serve url instead (with status, when set)
 *   { type: "response", response }                 send this response as it is
 * requestHeaders (an object) replaces the request's headers when set.
 */
export function interpretMiddlewareResponse(response, requestUrl) {
  if (!response) return { type: "next", headers: [], requestHeaders: null };
  const h = response.headers;
  const rewrite = h.get("x-middleware-rewrite");
  if (!rewrite && !h.get("x-middleware-next")) return { type: "response", response };

  let requestHeaders = null;
  const override = h.get("x-middleware-override-headers");
  if (override !== null) {
    requestHeaders = {};
    for (const name of override.split(",").map((s) => s.trim()).filter(Boolean)) {
      const v = h.get(`x-middleware-request-${name}`);
      if (v !== null) requestHeaders[name] = v;
    }
  }
  const headers = [];
  for (const [k, v] of h) {
    if (INTERNAL.test(k) || FRAMING.has(k) || k === "set-cookie") continue;
    headers.push([k, v]);
  }
  for (const c of h.getSetCookie()) headers.push(["set-cookie", c]);
  if (rewrite) {
    const status = response.status !== 200 ? response.status : null;
    return { type: "rewrite", url: new URL(rewrite, requestUrl), headers, requestHeaders, status };
  }
  return { type: "next", headers, requestHeaders };
}

/**
 * Run the app's middleware for a request, or return null when there is
 * none or its matcher skips the path. `pathname` is the page path (data
 * requests arrive normalised).
 */
export async function runMiddleware(server, ctx, req, pathname, search, query) {
  if (ctx.middlewareFile === undefined) ctx.middlewareFile = findMiddleware(ctx.root);
  if (!ctx.middlewareFile) return null;
  const mod = await server.ssrLoadModule(ctx.middlewareFile);
  const fn = mod.middleware || mod.proxy || mod.default;
  if (typeof fn !== "function") return null;
  if (!middlewareMatches(mod.config, pathname, { headers: req.headers, query })) return null;

  const { NextRequest } = await server.ssrLoadModule(shimPath("server.js"));
  const host = req.headers.host || "localhost";
  const url = `http://${host}${pathname}${search}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  const request = new NextRequest(url, { method: req.method, headers });
  const waits = [];
  const event = { waitUntil: (p) => waits.push(Promise.resolve(p).catch((e) => console.error(e))), sourcePage: pathname };
  const response = await fn(request, event);
  return interpretMiddlewareResponse(response, url);
}
