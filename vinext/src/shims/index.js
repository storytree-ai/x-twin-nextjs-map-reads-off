// The next/* modules vinext provides, and where each shim lives.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const SHIM_FILES = {
  next: "next.js",
  "next/app": "app.js",
  "next/cache": "cache.js",
  "next/compat/router": "compat-router.js",
  "next/config": "config.js",
  "next/document": "document.js",
  "next/dynamic": "dynamic.js",
  "next/form": "form.js",
  "next/head": "head.js",
  "next/headers": "headers.js",
  "next/image": "image.js",
  "next/link": "link.js",
  "next/navigation": "navigation.js",
  "next/og": "og.js",
  "next/router": "router.js",
  "next/script": "script.js",
  "next/server": "server.js",
};

/** Absolute path of a shim file by its file name (e.g. "router.js"). */
export function shimPath(file) {
  return path.join(here, file);
}

/** The shim for a next/* specifier (also accepts a trailing .js), or null. */
export function resolveShim(id) {
  const bare = id.replace(/\.js$/, "");
  const file = SHIM_FILES[bare];
  return file ? shimPath(file) : null;
}
