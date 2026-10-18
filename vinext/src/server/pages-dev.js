// Pages Router server rendering in `vinext dev`. Each request goes through
// Next.js's order: next.config headers and redirects, middleware,
// beforeFiles rewrites, static routes, afterFiles rewrites, dynamic routes,
// fallback rewrites. Pages run getServerSideProps / getStaticProps (ISR when
// they revalidate) / getInitialProps, render _app + page inside _document,
// and Vite adds its client. /_next/data/<build>/<path>.json answers the same
// page as JSON for client-side navigation.
import { createElement } from "react";
import { Writable } from "node:stream";
import { scanPagesDir, matchRoute } from "../routing/pages-routes.js";
import { shimPath } from "../shims/index.js";
import { PAGES_CLIENT_URL } from "../client/pages-entry.js";
import { handleApiRoute } from "./api.js";
import { fillDocument } from "./document-html.js";
import { searchToQuery, trailingSlashRedirect } from "./request-utils.js";
import { loadRules, collectHeaders, findRedirect, findRewrite } from "./config-rules.js";
import { runMiddleware } from "./middleware.js";
import { createIsrCache, isrCacheControl } from "./isr-cache.js";
import { runWithRequestStore } from "./ssr-context.js";
import { reportRequestError } from "./instrumentation.js";

const BUILD_ID = "development";
const DATA_PATH = /^\/_next\/data\/[^/]+\/(.+)\.json$/;
const GSSP_CACHE_CONTROL = "private, no-cache, no-store, max-age=0, must-revalidate";

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

/** The page path a /_next/data/<build>/<path>.json request asks for, or null. */
export function dataRequestPath(pathname) {
  const m = DATA_PATH.exec(pathname);
  if (!m) return null;
  return m[1] === "index" ? "/" : `/${m[1]}`;
}

const isDynamic = (route) => route.segments.some((s) => s.type !== "static");

/** The api or page route for pathname: static routes only, dynamic only, or both. */
function matchFiles(scan, pathname, which) {
  const pick = (routes) =>
    routes.filter((r) => which === "all" || (which === "dynamic") === isDynamic(r));
  const api = matchRoute(pick(scan.api), pathname);
  if (api) return { kind: "api", match: api };
  const page = matchRoute(pick(scan.pages), pathname);
  if (page) return { kind: "page", match: page };
  return null;
}

function setResponseHeader(res, key, value) {
  const lower = key.toLowerCase();
  if (lower === "set-cookie" || lower === "vary") {
    const prev = res.getHeader(key);
    const list = prev === undefined ? [] : [].concat(prev);
    if (lower === "vary") res.setHeader(key, [...list, value].join(", "));
    else res.setHeader(key, [...list, value]);
  } else {
    res.setHeader(key, value);
  }
}

async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  for (const [k, v] of response.headers) {
    if (k === "set-cookie" || k === "content-length" || k === "transfer-encoding") continue;
    res.setHeader(k, v);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", [...[].concat(res.getHeader("set-cookie") || []), ...cookies]);
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  res.end(body);
}

function sendRedirect(res, location, status, isData) {
  if (isData) return sendJson(res, 200, { redirect: location, status });
  res.statusCode = status;
  res.setHeader("Location", location);
  res.end();
}

function sendJson(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.removeHeader("Content-Length");
  res.end(JSON.stringify(value));
}

/** Replace a Node request's headers with middleware's overrides. */
function replaceRequestHeaders(req, headers) {
  for (const k of Object.keys(req.headers)) delete req.headers[k];
  Object.assign(req.headers, headers);
}

export function createPagesDevHandler(server, ctx) {
  let rules = null;
  const isr = createIsrCache();

  return async function vinextPages(req, res, next) {
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      return next();
    }
    if (isInternalRequest(url.pathname)) return next();
    const dataPath = dataRequestPath(url.pathname);
    const isData = dataPath !== null;
    let pathname = isData ? dataPath : url.pathname;

    // Next.js strips trailing slashes by default.
    const strippedLocation =
      ctx.nextConfig.trailingSlash || isData ? null : trailingSlashRedirect(pathname, url.search);
    if (strippedLocation) {
      res.statusCode = 308;
      res.setHeader("Location", strippedLocation);
      return res.end();
    }

    // What instrumentation's onRequestError hears about a failure here.
    const errorContext = { routerKind: "Pages Router", routePath: pathname, routeType: "render" };
    try {
      rules ??= await loadRules(ctx.nextConfig);
      const scan = scanPagesDir(ctx.pagesDir);
      let query = searchToQuery(url.searchParams);
      const original = { headers: { ...req.headers }, query };

      // 1-2. next.config headers and redirects see the request as it came.
      for (const h of collectHeaders(rules.headers, pathname, original)) setResponseHeader(res, h.key, h.value);
      const redirect = findRedirect(rules.redirects, pathname, url.search, original);
      if (redirect) return sendRedirect(res, redirect.location, redirect.status, isData);

      // 3. middleware.
      const mw = await runMiddleware(server, ctx, req, pathname, url.search, query);
      if (mw) {
        if (mw.type === "response") {
          const location = mw.response.headers.get("location");
          if (isData && location && mw.response.status >= 300 && mw.response.status < 400) {
            for (const c of mw.response.headers.getSetCookie()) setResponseHeader(res, "set-cookie", c);
            return sendRedirect(res, location, mw.response.status, true);
          }
          return await sendWebResponse(res, mw.response);
        }
        for (const [k, v] of mw.headers) setResponseHeader(res, k, v);
        if (mw.requestHeaders) replaceRequestHeaders(req, mw.requestHeaders);
        if (mw.type === "rewrite") {
          if (mw.url.host !== (req.headers.host || mw.url.host)) {
            return await sendWebResponse(res, await fetch(mw.url, { headers: { ...req.headers, host: mw.url.host } }));
          }
          pathname = mw.url.pathname;
          query = { ...query, ...searchToQuery(mw.url.searchParams) };
        }
      }

      const current = () => ({ headers: req.headers, query });
      const rewrite = async (list) => {
        const r = findRewrite(list, pathname, current());
        if (!r) return false;
        if (r.external) {
          await sendWebResponse(res, await fetch(r.external));
          return "sent";
        }
        pathname = r.pathname;
        query = { ...query, ...r.query };
        return true;
      };

      // 4-8. beforeFiles, files, afterFiles, dynamic routes, fallback.
      if ((await rewrite(rules.rewrites.beforeFiles)) === "sent") return;
      let target = matchFiles(scan, pathname, "static");
      if (!target) {
        const r = await rewrite(rules.rewrites.afterFiles);
        if (r === "sent") return;
        target = r ? matchFiles(scan, pathname, "all") : null;
      }
      target ??= matchFiles(scan, pathname, "dynamic");
      if (!target) {
        const r = await rewrite(rules.rewrites.fallback);
        if (r === "sent") return;
        if (r) target = matchFiles(scan, pathname, "all");
      }

      if (target) {
        errorContext.routePath = target.match.route.pattern;
        errorContext.routeType = target.kind === "api" ? "route" : "render";
      }
      if (target && target.kind === "api" && !isData) {
        return await handleApiRoute(server, target.match, req, res, { ...query, ...target.match.params });
      }
      const asPath = isData ? pathname + url.search : url.pathname + url.search;
      const page = target && target.kind === "page" ? target.match : null;
      if (!page && ctx.appDir && !isData) return next();
      return await runWithRequestStore(() =>
        servePage(server, ctx, scan, isr, page, { req, res, query, asPath, pathname, isData }),
      );
    } catch (err) {
      sendError(server, res, err);
      await reportRequestError(ctx, err, req, errorContext);
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

/** Is this page's path among getStaticPaths' paths? */
function inStaticPaths(paths, route, pathname) {
  for (const p of paths || []) {
    if (typeof p === "string") {
      if (p.replace(/\/$/, "") === pathname) return true;
      continue;
    }
    const params = (p && p.params) || {};
    const built =
      "/" +
      route.segments
        .map((s) => {
          if (s.type === "static") return s.value;
          const v = params[s.name];
          return Array.isArray(v) ? v.join("/") : v;
        })
        .filter((s) => s !== undefined && s !== "")
        .join("/");
    if (built === pathname) return true;
  }
  return false;
}

async function servePage(server, ctx, scan, isr, page, opts) {
  const { res, isData } = opts;
  let route = page && page.route;
  let params = (page && page.params) || {};
  let status = 200;
  if (!route) {
    const notFoundFile = scan.special["404"];
    if (!notFoundFile) return isData ? sendJson(res, 404, { notFound: true }) : sendNotFound(res);
    route = { pattern: "/404", file: notFoundFile, segments: [] };
    params = {};
    status = 404;
  }

  const pageMod = await server.ssrLoadModule(route.file);
  const isGssp = typeof pageMod.getServerSideProps === "function";
  const isGsp = !isGssp && typeof pageMod.getStaticProps === "function";

  if (isGsp && typeof pageMod.getStaticPaths === "function" && isDynamic(route)) {
    const sp = (await pageMod.getStaticPaths({ locales: undefined, defaultLocale: undefined })) || {};
    if (sp.fallback === false && !inStaticPaths(sp.paths, route, opts.pathname)) {
      return servePage(server, ctx, scan, isr, null, opts);
    }
  }

  // Cached renders carry both the HTML and the JSON, whichever asked first.
  const produce = () =>
    runWithRequestStore(() => renderPage(server, ctx, scan, route, params, pageMod, { ...opts, status, isData: false }));

  let result;
  if (isGsp && status === 200) {
    const { state, entry } = await isr.get(`${route.pattern}\0${opts.pathname}`, produce);
    result = entry;
    if (state) {
      res.setHeader("X-Vinext-Cache", state);
      res.setHeader("Cache-Control", isrCacheControl(entry.revalidate));
    }
  } else {
    result = await renderPage(server, ctx, scan, route, params, pageMod, { ...opts, status });
  }

  if (result.kind === "ended" || res.writableEnded) return;
  if (result.kind === "redirect") return sendRedirect(res, result.location, result.status, isData);
  if (result.kind === "notFound") {
    if (route.pattern === "/404") return isData ? sendJson(res, 404, { notFound: true }) : sendNotFound(res);
    return servePage(server, ctx, scan, isr, null, opts);
  }
  if (isGssp && !res.getHeader("Cache-Control")) res.setHeader("Cache-Control", GSSP_CACHE_CONTROL);
  // getServerSideProps may have set a status (or a Content-Length that no
  // longer fits the rendered body).
  const finalStatus = status !== 200 ? status : res.statusCode || 200;
  res.removeHeader("Content-Length");
  if (isData) return sendJson(res, finalStatus, result.nextData);
  res.statusCode = finalStatus;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(result.html);
}

async function runDataFetching(pageMod, { params, query, req, res, asPath, pattern, isGsp }) {
  if (typeof pageMod.getServerSideProps === "function") {
    return await pageMod.getServerSideProps({ params, query, req, res, resolvedUrl: asPath, locales: undefined });
  }
  if (isGsp) {
    return await pageMod.getStaticProps({ params, locales: undefined, preview: false });
  }
  const Page = pageMod.default;
  if (Page && typeof Page.getInitialProps === "function") {
    const props = await Page.getInitialProps({ req, res, query, pathname: pattern, asPath });
    return { props: props || {} };
  }
  return { props: {} };
}

/** Render to a string once every Suspense boundary has resolved. */
function renderToHtml(renderToPipeableStream, element) {
  return new Promise((resolve, reject) => {
    let html = "";
    const sink = new Writable({
      write(chunk, _enc, cb) {
        html += chunk.toString();
        cb();
      },
      final(cb) {
        resolve(html);
        cb();
      },
    });
    const stream = renderToPipeableStream(element, {
      onAllReady() {
        stream.pipe(sink);
      },
      onShellError: reject,
      onError(err) {
        console.error(err);
      },
    });
  });
}

/**
 * Data fetching and rendering for one page. Returns
 *   { kind: "ended" }                           getServerSideProps ended the response
 *   { kind: "redirect", location, status }
 *   { kind: "notFound" }
 *   { kind: "page", html, nextData }
 * each with `revalidate` when getStaticProps asked for ISR.
 */
async function renderPage(server, ctx, scan, route, params, pageMod, opts) {
  const { req, res } = opts;
  const isGsp = typeof pageMod.getServerSideProps !== "function" && typeof pageMod.getStaticProps === "function";
  // getStaticProps pages render without the request (they are cached).
  const query = isGsp ? { ...params } : { ...opts.query, ...params };
  const asPath = isGsp ? opts.pathname : opts.asPath;

  const configShim = await server.ssrLoadModule(shimPath("config.js"));
  const runtimeConfig = {
    serverRuntimeConfig: ctx.nextConfig.serverRuntimeConfig || {},
    publicRuntimeConfig: ctx.nextConfig.publicRuntimeConfig || {},
  };
  configShim.setConfig(runtimeConfig);

  let result = await runDataFetching(pageMod, {
    params,
    query,
    req: isGsp ? undefined : req,
    res: isGsp ? undefined : res,
    asPath,
    pattern: route.pattern,
    isGsp,
  });
  if (!isGsp && res.writableEnded) return { kind: "ended" };
  result = result || {};
  const revalidate = isGsp && typeof result.revalidate === "number" ? result.revalidate : undefined;
  if (result.redirect) {
    const { destination, permanent, statusCode } = result.redirect;
    return { kind: "redirect", location: destination, status: statusCode || (permanent ? 308 : 307), revalidate };
  }
  if (result.notFound) return { kind: "notFound", revalidate };
  let pageProps = (await result.props) || {};

  const [routerShim, headShim, appShim, { renderToPipeableStream, renderToStaticMarkup }] = await Promise.all([
    server.ssrLoadModule(shimPath("router.js")),
    server.ssrLoadModule(shimPath("head.js")),
    server.ssrLoadModule(shimPath("app.js")),
    import("react-dom/server"),
  ]);
  const appMod = scan.special.app ? await server.ssrLoadModule(scan.special.app) : null;
  const App = (appMod && appMod.default) || appShim.default;

  routerShim.setSSRContext({ pathname: route.pattern, query, asPath });
  let appProps = {};
  if (App !== appShim.default && typeof App.getInitialProps === "function") {
    appProps =
      (await App.getInitialProps({
        Component: pageMod.default,
        router: routerShim.default,
        ctx: { req, res, pathname: route.pattern, query, asPath },
      })) || {};
    pageProps = { ...(appProps.pageProps || {}), ...pageProps };
  }

  headShim.resetSSRHead();
  headShim._setHeadRenderer(renderToStaticMarkup);
  const appHtml = await renderToHtml(
    renderToPipeableStream,
    createElement(App, { ...appProps, Component: pageMod.default, pageProps, router: routerShim.default }),
  );
  const headHtml = headShim.getSSRHeadHTML();
  headShim.resetSSRHead();

  const nextData = {
    props: { ...appProps, pageProps },
    page: route.pattern,
    query,
    buildId: BUILD_ID,
    isFallback: false,
    gssp: typeof pageMod.getServerSideProps === "function" ? true : undefined,
    gsp: isGsp ? true : undefined,
    runtimeConfig: Object.keys(runtimeConfig.publicRuntimeConfig).length ? runtimeConfig.publicRuntimeConfig : undefined,
  };
  if (opts.isData) return { kind: "page", nextData, html: null, revalidate };

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

  html = await server.transformIndexHtml(asPath, html, req && req.originalUrl);
  return { kind: "page", nextData, html, revalidate };
}

function sendNotFound(res) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end("<!DOCTYPE html><html><head><title>404: This page could not be found</title></head><body><h1>404</h1><p>This page could not be found.</p></body></html>");
}
