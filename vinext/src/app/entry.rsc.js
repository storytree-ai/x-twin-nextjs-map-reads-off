// The App Router's RSC entry (rsc environment): one Web Request in, one
// Response out. route.ts handlers answer directly; pages render as a React
// Server Components tree (layouts, templates, boundaries, page) that is
// sent as the RSC payload to client navigations (header RSC: 1) or handed
// to the SSR entry for HTML.
import { createElement as h, Fragment, Suspense } from "react";
import { renderToReadableStream } from "@vitejs/plugin-rsc/rsc";
import { routes, rootLevel } from "virtual:vinext/app-routes";
import { matchRoute } from "../routing/pages-routes.js";
import { ErrorBoundary, NotFoundBoundary } from "./boundaries.js";
import { httpFallbackStatus, parseRedirectError } from "../shims/navigation-shared.js";
import { createAppRequestStore, takeSetCookies } from "../shims/headers.js";
import { NextRequest } from "../shims/server.js";
import { runWithRequestStore } from "../server/ssr-context.js";
import { resolveMetadata, renderMetadata } from "./metadata.js";

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
const FALLBACK_FILES = { 404: "notFound", 403: "forbidden", 401: "unauthorized" };
const FALLBACK_TEXT = {
  404: "This page could not be found.",
  403: "This page is forbidden.",
  401: "You are not authorized to access this page.",
};
const RSC_CONTENT_TYPE = "text/x-component; charset=utf-8";

/** params as Next.js 15 passes them: a Promise that also has the values. */
function thenable(value) {
  return Object.assign(Promise.resolve(value), value);
}

function searchToObject(searchParams) {
  const out = {};
  for (const [k, v] of searchParams) {
    out[k] = k in out ? [].concat(out[k], v) : v;
  }
  return out;
}

function pickParams(params, names) {
  const out = {};
  for (const n of names) if (params[n] !== undefined) out[n] = params[n];
  return out;
}

const isClientReference = (c) => !!c && c.$$typeof === Symbol.for("react.client.reference");

async function load(lazy) {
  return lazy ? await lazy() : null;
}

/** Each level's convention modules, loaded in parallel. */
function loadLevels(levels) {
  return Promise.all(
    levels.map(async (level) => {
      const [layout, template, notFound, error, loading, globalError, forbidden, unauthorized] = await Promise.all(
        ["layout", "template", "notFound", "error", "loading", "globalError", "forbidden", "unauthorized"].map((k) =>
          load(level[k]),
        ),
      );
      return { paramNames: level.paramNames, layout, template, notFound, error, loading, globalError, forbidden, unauthorized };
    }),
  );
}

/**
 * Wrap node in levels[0..upTo]'s layouts, templates and boundaries,
 * innermost first. withBoundaries=false leaves out the boundaries of
 * level upTo itself (a fallback already rendered there).
 */
function wrapLevels(node, mods, upTo, params, pathname, { boundariesAtLeaf = true } = {}) {
  for (let i = upTo; i >= 0; i--) {
    const m = mods[i];
    const boundaries = i < upTo || boundariesAtLeaf;
    if (boundaries && m.notFound) {
      node = h(NotFoundBoundary, { fallback: h(m.notFound.default) }, node);
    }
    if (boundaries && m.loading && m.loading.default) {
      node = h(Suspense, { fallback: h(m.loading.default) }, node);
    }
    if (boundaries && m.error && m.error.default) {
      node = h(ErrorBoundary, { errorComponent: m.error.default }, node);
    }
    if (m.template && m.template.default) {
      node = h(m.template.default, { key: pathname }, node);
    }
    if (m.layout && m.layout.default) {
      node = h(m.layout.default, { params: thenable(pickParams(params, m.paramNames)) }, node);
    }
  }
  if (!mods[0] || !mods[0].layout) node = h("html", null, h("body", null, node));
  if (mods[0] && mods[0].globalError && mods[0].globalError.default) {
    node = h(ErrorBoundary, { errorComponent: mods[0].globalError.default }, node);
  }
  return node;
}

function defaultFallback(status) {
  return h(
    "div",
    { style: { fontFamily: "system-ui, sans-serif", textAlign: "center", marginTop: "20vh" } },
    h("h1", null, String(status)),
    h("p", null, FALLBACK_TEXT[status] || ""),
  );
}

/** The tree for a notFound()/forbidden()/unauthorized() at level `from` or above. */
function fallbackTree(status, mods, from, params, pathname, meta) {
  const key = FALLBACK_FILES[status] || "notFound";
  let at = -1;
  for (let i = Math.min(from, mods.length - 1); i >= 0; i--) {
    if (mods[i][key] && mods[i][key].default) {
      at = i;
      break;
    }
  }
  const leaf = at >= 0 ? h(mods[at][key].default) : defaultFallback(status);
  const body = h(Fragment, null, ...meta, h("meta", { name: "robots", content: "noindex" }), leaf);
  return wrapLevels(body, mods, Math.max(at, 0), params, pathname, { boundariesAtLeaf: false });
}

function redirectResponse(redirect) {
  return new Response(null, { status: redirect.status, headers: { location: redirect.url } });
}

async function renderPayload(request, url, payload, status, nav) {
  const isRsc = request.headers.get("rsc") === "1";
  const rscStream = renderToReadableStream(payload, {
    onError(err) {
      if (err && typeof err === "object" && typeof err.digest === "string") return err.digest;
      if (!isRsc) console.error(err);
    },
  });
  if (isRsc) {
    return new Response(rscStream, { status, headers: { "content-type": RSC_CONTENT_TYPE, vary: "RSC" } });
  }
  const ssr = await import.meta.viteRsc.loadModule("ssr", "index");
  const html = await ssr.renderHtml(rscStream, nav);
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", vary: "RSC" } });
}

async function renderPage(request, url, match) {
  const pathname = url.pathname;
  const params = match ? match.params : {};
  const route = match ? match.route : null;
  const levels = route ? route.levels : [rootLevel];
  const mods = await loadLevels(levels);
  const nav = { pathname, search: url.search.slice(1), params };
  const searchParams = searchToObject(url.searchParams);

  if (!route) {
    const meta = renderMetadata(await resolveMetadata(mods.map((m) => m.layout), [], params, searchParams));
    return renderPayload(request, url, { tree: fallbackTree(404, mods, 0, params, pathname, meta), params }, 404, nav);
  }

  const pageMod = await route.module();
  const Page = pageMod.default;
  const props = { params: thenable(params), searchParams: thenable(searchParams) };
  const leafIndex = mods.length - 1;
  let meta = [];
  let leaf;
  try {
    const metadata = await resolveMetadata(
      mods.map((m) => m.layout),
      mods.map((m) => m.paramNames),
      params,
      searchParams,
      pageMod,
    );
    meta = renderMetadata(metadata);
    // Run the page up front where its status can still be chosen: a
    // notFound() or redirect() there answers 404 / 307 instead of a
    // streamed boundary. Under a loading.tsx the page streams instead.
    const canProbe = typeof Page === "function" && !isClientReference(Page) && !mods.some((m) => m.loading);
    if (canProbe) {
      try {
        leaf = await Page(props);
      } catch (err) {
        if (parseRedirectError(err) || httpFallbackStatus(err)) throw err;
        leaf = h(Page, props); // render it again in place so its error boundary shows the error
      }
    } else {
      leaf = Page ? h(Page, props) : null;
    }
  } catch (err) {
    const redirect = parseRedirectError(err);
    if (redirect) return redirectResponse(redirect);
    const status = httpFallbackStatus(err);
    if (!status) throw err;
    const tree = fallbackTree(status, mods, leafIndex, params, pathname, meta);
    return renderPayload(request, url, { tree, params }, status, nav);
  }
  const tree = wrapLevels(h(Fragment, null, ...meta, leaf ?? null), mods, leafIndex, params, pathname);
  return renderPayload(request, url, { tree, params }, 200, nav);
}

async function handleRoute(request, match) {
  const mod = await match.route.module();
  const method = request.method.toUpperCase();
  const exported = HTTP_METHODS.filter((m) => typeof mod[m] === "function");
  let fn = mod[method];
  const headFromGet = !fn && method === "HEAD" && typeof mod.GET === "function";
  if (headFromGet) fn = mod.GET;
  if (typeof fn !== "function") {
    if (method === "OPTIONS" && exported.length) {
      const allow = new Set([...exported, "OPTIONS"]);
      if (allow.has("GET")) allow.add("HEAD");
      return new Response(null, { status: 204, headers: { allow: [...allow].sort().join(", ") } });
    }
    return new Response(null, { status: 405 });
  }
  let response;
  try {
    response = await fn(new NextRequest(request), { params: thenable(match.params) });
  } catch (err) {
    const redirect = parseRedirectError(err);
    if (redirect) return redirectResponse(redirect);
    const status = httpFallbackStatus(err);
    if (status) return new Response(null, { status });
    console.error(err);
    return new Response(null, { status: 500 });
  }
  if (!(response instanceof Response)) {
    console.error(new Error(`No response is returned from route handler '${match.route.pattern}'.`));
    return new Response(null, { status: 500 });
  }
  const headers = new Headers(response.headers);
  if (
    (method === "GET" || method === "HEAD") &&
    typeof mod.revalidate === "number" &&
    mod.revalidate > 0 &&
    mod.revalidate !== Infinity &&
    !headers.has("cache-control")
  ) {
    headers.set("cache-control", `s-maxage=${mod.revalidate}, stale-while-revalidate`);
  }
  const body = method === "HEAD" ? null : response.body;
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function withCookies(response, cookies) {
  if (!cookies.length) return response;
  const headers = new Headers(response.headers);
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default function handler(request) {
  return runWithRequestStore(async () => {
    const store = globalThis.__VINEXT_SSR_ALS__.getStore();
    store.appRequest = createAppRequestStore(request.headers);
    const url = new URL(request.url);
    const match = matchRoute(routes, url.pathname);
    const response =
      match && match.route.kind === "route" ? await handleRoute(request, match) : await renderPage(request, url, match);
    return withCookies(response, takeSetCookies(store.appRequest));
  });
}
