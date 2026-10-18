// Load next.config.{js,mjs,cjs,ts} the way Next.js does: the default export
// may be an object or a function of (phase, { defaultConfig }).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const CONFIG_FILES = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs", "next.config.mts", "next.config.cts"];

export const PHASE_DEVELOPMENT_SERVER = "phase-development-server";
export const PHASE_PRODUCTION_BUILD = "phase-production-build";
export const PHASE_PRODUCTION_SERVER = "phase-production-server";

export function findNextConfig(root) {
  for (const name of CONFIG_FILES) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function importConfigFile(file) {
  if (file.endsWith(".cjs")) {
    const mod = createRequire(file)(file);
    return mod && mod.__esModule && "default" in mod ? mod.default : mod;
  }
  if (/\.(c|m)?ts$/.test(file)) {
    // TypeScript configs go through Vite's own module runner.
    const { runnerImport } = await import("vite");
    const { module } = await runnerImport(file, { root: path.dirname(file), configFile: false, logLevel: "silent" });
    return module.default ?? module;
  }
  const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  return mod.default ?? mod;
}

export async function loadNextConfig(root, phase = PHASE_DEVELOPMENT_SERVER) {
  const file = findNextConfig(root);
  if (!file) return { file: null, config: {} };
  let config = await importConfigFile(file);
  if (typeof config === "function") config = await config(phase, { defaultConfig: {} });
  return { file, config: config || {} };
}
