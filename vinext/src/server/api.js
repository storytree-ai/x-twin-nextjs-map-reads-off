// Pages Router API routes (pages/api/**) on Node's req/res, with the
// Next.js helpers: req.query, req.cookies, req.body, res.status/json/send/redirect.
import { searchToQuery } from "./request-utils.js";

function parseCookies(header) {
  const cookies = new Map();
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      const v = part.slice(i + 1).trim();
      try {
        cookies.set(part.slice(0, i).trim(), decodeURIComponent(v));
      } catch {
        cookies.set(part.slice(0, i).trim(), v);
      }
    }
  }
  return Object.fromEntries(cookies);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const raw = await readBody(req);
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const text = raw.toString("utf8");
  if (type === "application/json" || type.endsWith("+json")) {
    if (!text) return {};
    return JSON.parse(text);
  }
  if (type === "application/x-www-form-urlencoded") return searchToQuery(new URLSearchParams(text));
  if (type.startsWith("text/") || !type) return text;
  return raw;
}

function enhanceResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (data) => {
    if (data === undefined || data === null) {
      res.end();
    } else if (Buffer.isBuffer(data)) {
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", data.length);
      res.end(data);
    } else if (typeof data === "object") {
      return res.json(data);
    } else {
      const body = String(data);
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Length", Buffer.byteLength(body));
      res.end(body);
    }
    return res;
  };
  res.redirect = (statusOrUrl, maybeUrl) => {
    const [code, location] = typeof statusOrUrl === "number" ? [statusOrUrl, maybeUrl] : [307, statusOrUrl];
    res.statusCode = code;
    res.setHeader("Location", location);
    res.end();
    return res;
  };
  return res;
}

export async function handleApiRoute(server, match, req, res, query) {
  const mod = await server.ssrLoadModule(match.route.file);
  const handler = mod.default;
  if (typeof handler !== "function") {
    res.statusCode = 500;
    res.end(`API route ${match.route.pattern} has no default export handler`);
    return;
  }
  req.query = query;
  req.cookies = parseCookies(req.headers.cookie);
  const bodyParser = mod.config && mod.config.api && mod.config.api.bodyParser;
  if (bodyParser !== false) {
    try {
      req.body = await parseBody(req);
    } catch {
      res.statusCode = 400;
      res.end("Invalid JSON");
      return;
    }
  }
  enhanceResponse(res);
  await handler(req, res);
}
