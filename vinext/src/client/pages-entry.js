// The browser entry for the Pages Router: the page map (route pattern →
// lazy import) handed to the runtime that hydrates #__next and navigates.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PAGES_CLIENT_ID = "virtual:vinext-pages-client";
export const RESOLVED_PAGES_CLIENT_ID = "\0" + PAGES_CLIENT_ID;
export const PAGES_CLIENT_URL = "/@id/__x00__" + PAGES_CLIENT_ID;

/** Import specifier for a file: root-relative inside the root, /@fs otherwise. */
export function toImportPath(root, file) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  return rel.startsWith("..") ? `/@fs${file.split(path.sep).join("/")}` : `/${rel}`;
}

// The runtime is imported by a specifier vinext's resolveId answers, like
// the next/* shims: a plain path into node_modules would get Vite's ?v=
// query and load a second copy of next/router beside the pages' one.
export const PAGES_RUNTIME_ID = "vinext/pages-runtime";
export const PAGES_RUNTIME_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "pages-runtime.js");

export function generatePagesClientEntry(root, scan) {
  const loaders = scan.pages
    .map((r) => `  ${JSON.stringify(r.pattern)}: () => import(${JSON.stringify(toImportPath(root, r.file))}),`)
    .join("\n");
  const app = scan.special.app
    ? `() => import(${JSON.stringify(toImportPath(root, scan.special.app))})`
    : "null";
  return `import { startPagesClient } from ${JSON.stringify(PAGES_RUNTIME_ID)};

const pages = {
${loaders}
};

startPagesClient({
  pages,
  patterns: ${JSON.stringify(scan.pages.map((r) => r.pattern))},
  loadApp: ${app},
});
`;
}
