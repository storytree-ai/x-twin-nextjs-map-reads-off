// vinext: the Vite plugin that runs a Next.js app. It resolves next/* imports
// to vinext's shims, loads next.config, and serves the Pages Router through
// Vite's dev server.
import path from "node:path";
import { detectRouters } from "./config/project.js";
import { loadNextConfig, PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "./config/next-config.js";
import { SHIM_FILES, resolveShim } from "./shims/index.js";
import { PAGES_CLIENT_ID, RESOLVED_PAGES_CLIENT_ID, generatePagesClientEntry } from "./client/pages-entry.js";
import { createPagesDevHandler } from "./server/pages-dev.js";
import { scanPagesDir, PAGE_EXTENSIONS } from "./routing/pages-routes.js";

export { loadNextConfig } from "./config/next-config.js";

const NEXT_IDS = Object.keys(SHIM_FILES);

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

      return {
        appType: "custom",
        resolve: {
          dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
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

    resolveId(id) {
      if (id === PAGES_CLIENT_ID) return RESOLVED_PAGES_CLIENT_ID;
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
