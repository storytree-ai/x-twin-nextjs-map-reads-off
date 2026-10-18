// The browser entry for the Pages Router: reads __NEXT_DATA__, loads the
// page and _app, and hydrates #__next.
import path from "node:path";
import { shimPath } from "../shims/index.js";

export const PAGES_CLIENT_ID = "virtual:vinext-pages-client";
export const RESOLVED_PAGES_CLIENT_ID = "\0" + PAGES_CLIENT_ID;
export const PAGES_CLIENT_URL = "/@id/__x00__" + PAGES_CLIENT_ID;

/** Import specifier for a file: root-relative inside the root, /@fs otherwise. */
export function toImportPath(root, file) {
  const rel = path.relative(root, file).split(path.sep).join("/");
  return rel.startsWith("..") ? `/@fs${file.split(path.sep).join("/")}` : `/${rel}`;
}

export function generatePagesClientEntry(root, scan) {
  const loaders = scan.pages
    .map((r) => `  ${JSON.stringify(r.pattern)}: () => import(${JSON.stringify(toImportPath(root, r.file))}),`)
    .join("\n");
  const app = scan.special.app
    ? `() => import(${JSON.stringify(toImportPath(root, scan.special.app))})`
    : "null";
  return `import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { _initClientRouter } from ${JSON.stringify(shimPath("router.js"))};
import DefaultApp from ${JSON.stringify(shimPath("app.js"))};

const pages = {
${loaders}
};
const loadApp = ${app};

async function hydrate() {
  const dataEl = document.getElementById("__NEXT_DATA__");
  const data = JSON.parse(dataEl ? dataEl.textContent : "{}");
  window.__NEXT_DATA__ = data;
  const loadPage = pages[data.page];
  if (!loadPage) {
    console.error("[vinext] no page module for", data.page);
    return;
  }
  const router = _initClientRouter({
    pathname: data.page,
    query: data.query || {},
    asPath: window.location.pathname + window.location.search,
  });
  const [pageMod, appMod] = await Promise.all([loadPage(), loadApp ? loadApp() : null]);
  const App = (appMod && appMod.default) || DefaultApp;
  const pageProps = (data.props && data.props.pageProps) || {};
  window.__VINEXT_ROOT__ = hydrateRoot(
    document.getElementById("__next"),
    createElement(App, { Component: pageMod.default, pageProps, router }),
  );
}

hydrate();
`;
}
