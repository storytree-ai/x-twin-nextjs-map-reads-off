// instrumentation.ts: register() runs once, before the first request is
// handled (not at startup: loading modules before the server listens
// breaks Vite's module runner), and onRequestError() hears about errors
// thrown while handling requests.
import fs from "node:fs";
import path from "node:path";

const EXTS = [".ts", ".js", ".mjs", ".tsx", ".jsx", ".mts"];

export function findInstrumentation(root) {
  for (const dir of [root, path.join(root, "src")]) {
    for (const ext of EXTS) {
      const file = path.join(dir, "instrumentation" + ext);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/** Load instrumentation once per server and call its register(). */
export function ensureInstrumentation(server, ctx) {
  if (!ctx.instrumentation) {
    ctx.instrumentation = (async () => {
      const file = findInstrumentation(ctx.root);
      if (!file) return null;
      const mod = await server.ssrLoadModule(file);
      if (typeof mod.register === "function") await mod.register();
      return mod;
    })().catch((err) => {
      console.error("[vinext] instrumentation register() failed:", err);
      return null;
    });
  }
  return ctx.instrumentation;
}

/** Tell instrumentation's onRequestError about an error, never throwing. */
export async function reportRequestError(ctx, err, req, context) {
  try {
    const mod = ctx.instrumentation ? await ctx.instrumentation : null;
    if (!mod || typeof mod.onRequestError !== "function") return;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers || {})) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
    await mod.onRequestError(
      err instanceof Error ? err : new Error(String(err)),
      { path: req.originalUrl || req.url, method: req.method, headers },
      context,
    );
  } catch (e) {
    console.error("[vinext] onRequestError failed:", e);
  }
}
