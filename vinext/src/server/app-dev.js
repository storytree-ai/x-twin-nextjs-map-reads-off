// App Router requests in `vinext dev`: the Node request becomes a Web
// Request for the RSC entry (run in the rsc environment's module runner),
// and its Response streams back. Mounted after the Pages Router handler,
// so it also answers the not-found page for paths neither router has.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { reportRequestError } from "./instrumentation.js";

function isInternalRequest(pathname) {
  return pathname.startsWith("/@") || pathname.startsWith("/__vite") || pathname.startsWith("/node_modules/");
}

// Static metadata files at app/'s root, served as they are.
const STATIC_METADATA = /^\/(favicon\.ico|(?:icon|apple-icon)\.(?:ico|png|jpe?g|gif|svg))$/;
const CONTENT_TYPES = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

/** Answer /favicon.ico, /icon.png, ... from app/ when the file is there. */
function serveStaticMetadata(appDir, pathname, res) {
  if (!STATIC_METADATA.test(pathname)) return false;
  const file = path.join(appDir, pathname.slice(1));
  if (!fs.existsSync(file)) return false;
  res.statusCode = 200;
  res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.end(fs.readFileSync(file));
  return true;
}

/** A Web Request for a Node request (the body streamed for non-GET/HEAD). */
export function toWebRequest(req) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.originalUrl || req.url || "/", `http://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (k.startsWith(":") || v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  const method = req.method || "GET";
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

/** Stream a Web Response to a Node response, keeping headers already set. */
export async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  for (const [k, v] of response.headers) {
    if (k === "set-cookie" || k === "content-length") continue;
    res.setHeader(k, v);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", [...[].concat(res.getHeader("set-cookie") || []), ...cookies]);
  if (!response.body) return res.end();
  res.flushHeaders();
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

export function createAppDevHandler(server, ctx, entryFile) {
  return async function vinextApp(req, res, next) {
    let pathname;
    try {
      pathname = new URL(req.url || "/", "http://localhost").pathname;
    } catch {
      return next();
    }
    if (isInternalRequest(pathname)) return next();
    if (serveStaticMetadata(ctx.appDir, pathname, res)) return;
    try {
      const entry = await server.environments.rsc.runner.import(entryFile);
      const response = await entry.default(toWebRequest(req));
      await sendWebResponse(res, response);
    } catch (err) {
      console.error(err);
      await reportRequestError(ctx, err, req, { routerKind: "App Router", routePath: pathname, routeType: "render" });
      if (res.headersSent) return res.end();
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("500: Internal Server Error");
    }
  };
}
