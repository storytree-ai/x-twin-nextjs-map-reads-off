// vinext: the Vite plugin that runs a Next.js app. It resolves next/* imports
// to vinext's shims, loads next.config, and serves the Pages Router through
// Vite's dev server.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectRouters } from "./config/project.js";
import { loadNextConfig, PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "./config/next-config.js";
import { SHIM_FILES, resolveShim } from "./shims/index.js";
import {
  PAGES_CLIENT_ID,
  RESOLVED_PAGES_CLIENT_ID,
  PAGES_RUNTIME_ID,
  PAGES_RUNTIME_FILE,
  generatePagesClientEntry,
} from "./client/pages-entry.js";
import { createPagesDevHandler } from "./server/pages-dev.js";
import { scanPagesDir, PAGE_EXTENSIONS } from "./routing/pages-routes.js";
import { transformCjs, CJS_HELPER_ID } from "./plugins/cjs.js";
import { ensureInstrumentation } from "./server/instrumentation.js";

const REQUEST_CONTEXT_ID = "vinext/unified-request-context";

export { loadNextConfig } from "./config/next-config.js";

const NEXT_IDS = Object.keys(SHIM_FILES);
const VINEXT_DIR = path.dirname(fileURLToPath(import.meta.url)) + path.sep;

export default function vinext(options = {}) {
  const ctx = {
    root: process.cwd(),
    pagesDir: null,
    appDir: null,
    nextConfig: {},
    nextConfigFile: null,
  };

  const core = {
    name: "vinext",
    enforce: "pre",

    async config(userConfig, env) {
      ctx.root = path.resolve(userConfig.root || process.cwd());
      Object.assign(ctx, detectRouters(ctx.root));
      const phase = env.command === "build" ? PHASE_PRODUCTION_BUILD : PHASE_DEVELOPMENT_SERVER;
      const { file, config } = await loadNextConfig(ctx.root, phase);
      ctx.nextConfig = config;
      ctx.nextConfigFile = file;

      const exts = PAGE_EXTENSIONS.map((e) => e.slice(1)).join(",");
      const entries = [];
      if (ctx.pagesDir) entries.push(`${path.relative(ctx.root, ctx.pagesDir)}/**/*.{${exts}}`);
      if (ctx.appDir) entries.push(`${path.relative(ctx.root, ctx.appDir)}/**/*.{${exts}}`);

      // next.config `env` and NEXT_PUBLIC_* variables are inlined into
      // client code and set on the server's process.env.
      const publicEnv = { ...(config.env || {}) };
      for (const [k, v] of Object.entries(process.env)) if (k.startsWith("NEXT_PUBLIC_")) publicEnv[k] = v;
      const define = {};
      for (const [k, v] of Object.entries(publicEnv)) {
        if (!(k in process.env)) process.env[k] = String(v);
        define[`process.env.${k}`] = JSON.stringify(String(v));
      }

      return {
        appType: "custom",
        define,
        resolve: {
          dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
          // tsconfig "paths" (e.g. "@/*"), as Next.js honours them.
          tsconfigPaths: true,
        },
        optimizeDeps: {
          entries,
          exclude: [...NEXT_IDS, "vinext"],
          include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
        },
        ssr: {
          noExternal: [/^next(\/|$)/, "vinext"],
        },
      };
    },

    resolveId(id, importer) {
      if (id === PAGES_CLIENT_ID) return RESOLVED_PAGES_CLIENT_ID;
      // Imports between vinext's own modules resolve here, so they get the
      // same URL as the shims the app imports through next/*: Vite's own
      // resolver would add a ?v= query to these node_modules paths and the
      // browser would load a second copy of next/router.
      if (importer && id[0] === "." && id.endsWith(".js")) {
        const from = importer.split("?")[0];
        if (from.startsWith(VINEXT_DIR)) return path.resolve(path.dirname(from), id);
      }
      if (id === PAGES_RUNTIME_ID) return PAGES_RUNTIME_FILE;
      if (id === CJS_HELPER_ID) return path.join(VINEXT_DIR, "plugins", "cjs.js");
      if (id === REQUEST_CONTEXT_ID) return path.join(VINEXT_DIR, "shims", "request-context.js");
      if (id === "next" || id.startsWith("next/")) {
        const shim = resolveShim(id);
        if (shim) return shim;
      }
      return null;
    },

    load(id) {
      if (id === RESOLVED_PAGES_CLIENT_ID) {
        const scan = ctx.pagesDir ? scanPagesDir(ctx.pagesDir) : { pages: [], special: {} };
        return generatePagesClientEntry(ctx.root, scan);
      }
      return null;
    },

    transform(code, id) {
      // CommonJS (require / module.exports) in the app's own source files.
      if (id[0] === "\0" || id.includes("/node_modules/")) return null;
      const file = id.split("?")[0];
      if (!file.startsWith(ctx.root + path.sep) || !/\.(m?[jt]sx?)$/.test(file)) return null;
      if (!code.includes("require(") && !code.includes("exports")) return null;
      const out = transformCjs(code);
      return out === null ? null : { code: out, map: null };
    },

    configureServer(server) {
      // New or removed pages change the client entry's page map.
      const refresh = (file) => {
        if (!ctx.pagesDir || !file.startsWith(ctx.pagesDir)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_PAGES_CLIENT_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on("add", refresh);
      server.watcher.on("unlink", refresh);

      // Runs after Vite's own middlewares (assets, transforms, HMR).
      return () => {
        server.middlewares.use((req, res, next) => {
          ensureInstrumentation(server, ctx).then(() => next(), next);
        });
        if (ctx.pagesDir) server.middlewares.use(createPagesDevHandler(server, ctx));
        server.middlewares.use((req, res) => {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("404: This page could not be found.");
        });
      };
    },
  };

  const reactPlugin = import("@vitejs/plugin-react").then(
    (m) => m.default(options.react),
    () => [],
  );

  return [reactPlugin, core];
}
