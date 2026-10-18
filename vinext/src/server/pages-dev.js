// Pages Router server rendering in `vinext dev`: match the request against
// pages/, run getServerSideProps / getStaticProps / getInitialProps, render
// _app + page inside _document, and hand Vite the HTML to add its client.
import { createElement } from "react";
import { scanPagesDir, matchRoute } from "../routing/pages-routes.js";
import { shimPath } from "../shims/index.js";
import { PAGES_CLIENT_URL } from "../client/pages-entry.js";
import { handleApiRoute } from "./api.js";
import { fillDocument } from "./document-html.js";

const BUILD_ID = "development";

/** Search params as a Next.js query object (repeated keys become arrays). */
export function searchToQuery(searchParams) {
  const query = {};
  for (const [k, v] of searchParams) {
    if (k in query) query[k] = [].concat(query[k], v);
    else query[k] = v;
  }
  return query;
}

/** JSON safe to embed in a <script> element. */
export function htmlSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function isInternalRequest(pathname) {
  return (
    pathname.startsWith("/@") ||
    pathname.startsWith("/__vite") ||
    pathname.startsWith("/node_modules/") ||
    pathname === "/favicon.ico"
  );
}

export function createPagesDevHandler(server, ctx) {
  return async function vinextPages(req, res, next) {
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      return next();
    }
    const { pathname } = url;
    if (isInternalRequest(pathname)) return next();

    // Next.js strips trailing slashes by default.
    if (pathname.length > 1 && pathname.endsWith("/") && !ctx.nextConfig.trailingSlash) {
      res.statusCode = 308;
      res.setHeader("Location", pathname.replace(/\/+$/, "") + url.search);
      return res.end();
    }

    try {
      const scan = scanPagesDir(ctx.pagesDir);
      const apiMatch = matchRoute(scan.api, pathname);
      if (apiMatch) {
        return await handleApiRoute(server, apiMatch, req, res, url);
      }
      const match = matchRoute(scan.pages, pathname);
      if (!match) {
        if (ctx.appDir) return next();
        return await renderPage(server, ctx, scan, null, req, res, url, 404);
      }
      return await renderPage(server, ctx, scan, match, req, res, url, 200);
    } catch (err) {
      sendError(server, res, err);
    }
  };
}

function sendError(server, res, err) {
  if (err instanceof Error) server.ssrFixStacktrace(err);
  console.error(err);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.statusCode = 500;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const message = String(err && err.stack ? err.stack : err)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  res.end(`<!DOCTYPE html><html><head><title>500: Internal Server Error</title></head><body><h1>500 - Internal Server Error</h1><pre>${message}</pre></body></html>`);
}

async function runDataFetching(pageMod, { params, query, req, res, url, pattern }) {
  const resolvedUrl = url.pathname + url.search;
  if (typeof pageMod.getServerSideProps === "function") {
    return await pageMod.getServerSideProps({ params, query, req, res, resolvedUrl, locales: undefined });
  }
  if (typeof pageMod.getStaticProps === "function") {
    return await pageMod.getStaticProps({ params, locales: undefined, preview: false });
  }
  const Page = pageMod.default;
  if (Page && typeof Page.getInitialProps === "function") {
    const props = await Page.getInitialProps({ req, res, query, pathname: pattern, asPath: resolvedUrl });
    return { props: props || {} };
  }
  return { props: {} };
}

async function renderPage(server, ctx, scan, match, req, res, url, status) {
  let route = match && match.route;
  let params = (match && match.params) || {};
  if (!route) {
    const notFoundFile = scan.special["404"];
    if (!notFoundFile) return sendNotFound(res);
    route = { pattern: "/404", file: notFoundFile };
    params = {};
  }

  const query = { ...searchToQuery(url.searchParams), ...params };
  const pageMod = await server.ssrLoadModule(route.file);

  let result = await runDataFetching(pageMod, { params, query, req, res, url, pattern: route.pattern });
  if (res.writableEnded) return;
  result = result || {};
  if (result.redirect) {
    const { destination, permanent, statusCode } = result.redirect;
    res.statusCode = statusCode || (permanent ? 308 : 307);
    res.setHeader("Location", destination);
    return res.end();
  }
  if (result.notFound) {
    if (route.pattern === "/404") return sendNotFound(res);
    return renderPage(server, ctx, scan, null, req, res, url, 404);
  }
  const pageProps = (await result.props) || {};

  const [routerShim, headShim, appShim, { renderToString, renderToStaticMarkup }] = await Promise.all([
    server.ssrLoadModule(shimPath("router.js")),
    server.ssrLoadModule(shimPath("head.js")),
    server.ssrLoadModule(shimPath("app.js")),
    import("react-dom/server"),
  ]);
  const appMod = scan.special.app ? await server.ssrLoadModule(scan.special.app) : null;
  const App = (appMod && appMod.default) || appShim.default;
  const asPath = url.pathname + url.search;

  routerShim.setSSRContext({ pathname: route.pattern, query, asPath });
  headShim.resetSSRHead();
  headShim._setHeadRenderer(renderToStaticMarkup);
  let appHtml;
  try {
    appHtml = renderToString(
      createElement(App, { Component: pageMod.default, pageProps, router: routerShim.default }),
    );
  } finally {
    routerShim.setSSRContext(null);
  }
  const headHtml = headShim.getSSRHeadHTML();
  headShim.resetSSRHead();

  const nextData = {
    props: { pageProps },
    page: route.pattern,
    query,
    buildId: BUILD_ID,
    isFallback: false,
    gssp: typeof pageMod.getServerSideProps === "function" ? true : undefined,
  };
  const scripts =
    `<script id="__NEXT_DATA__" type="application/json">${htmlSafeJson(nextData)}</script>` +
    `<script type="module" src="${PAGES_CLIENT_URL}"></script>`;

  let html;
  if (scan.special.document) {
    const docMod = await server.ssrLoadModule(scan.special.document);
    const Document = docMod.default;
    const markup = renderToStaticMarkup(createElement(Document, { __NEXT_DATA__: nextData }));
    html = "<!DOCTYPE html>" + fillDocument(markup, { head: headHtml, main: appHtml, scripts });
  } else {
    html =
      `<!DOCTYPE html><html><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width"/>${headHtml}</head>` +
      `<body><div id="__next">${appHtml}</div>${scripts}</body></html>`;
  }

  html = await server.transformIndexHtml(asPath, html, req.originalUrl);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

function sendNotFound(res) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end("<!DOCTYPE html><html><head><title>404: This page could not be found</title></head><body><h1>404</h1><p>This page could not be found.</p></body></html>");
}
