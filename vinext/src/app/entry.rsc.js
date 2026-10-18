// The App Router's RSC entry (rsc environment): one Web Request in, one
// Response out. route.ts handlers answer directly; pages render as a React
// Server Components tree (layouts, templates, boundaries, page) that is
// sent as the RSC payload to client navigations (header RSC: 1) or handed
// to the SSR entry for HTML.
import { createElement as h, Fragment, Suspense } from "react";
import {
  renderToReadableStream,
  createTemporaryReferenceSet,
  decodeReply,
  decodeAction,
  decodeFormState,
  loadServerAction,
} from "@vitejs/plugin-rsc/rsc";
import { routes, rootLevel, fileIcons, metadataRoutes } from "virtual:vinext/app-routes";
import { matchRoute } from "../routing/pages-routes.js";
import { ErrorBoundary, NotFoundBoundary, LayoutSegments } from "./boundaries.js";
import { httpFallbackStatus, parseRedirectError } from "../shims/navigation-shared.js";
import { createAppRequestStore, takeSetCookies } from "../shims/headers.js";
import { NextRequest } from "../shims/server.js";
import { runWithRequestStore } from "../server/ssr-context.js";
import { resolveMetadata, resolveViewport, metadataTags } from "./metadata.js";
import { metadataRouteResponse } from "./metadata-routes.js";
import { segmentConfig, pageCacheControl, inStaticParams } from "./segment-config.js";

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
const FALLBACK_FILES = { 404: "notFound", 403: "forbidden", 401: "unauthorized" };
const FALLBACK_TEXT = {
  404: "This page could not be found.",
  403: "This page is forbidden.",
  401: "You are not authorized to access this page.",
};
const RSC_CONTENT_TYPE = "text/x-component; charset=utf-8";
// The header a client-side server action call names its action in.
const ACTION_HEADER = "x-rsc-action";

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

/** The <head> elements for the metadata and viewport of layouts (and the page, when given). */
async function headElements(mods, params, searchParams, pageMod) {
  const layouts = mods.map((m) => m.layout);
  const names = mods.map((m) => m.paramNames);
  const [md, vp] = await Promise.all([
    resolveMetadata(layouts, names, params, searchParams, pageMod),
    resolveViewport(layouts, names, params, searchParams, pageMod),
  ]);
  return metadataTags(md, vp, fileIcons).map((t, i) => h(t.tag, { key: `m${i}`, ...t.props }, t.children));
}

async function load(lazy) {
  return lazy ? await lazy() : null;
}

const LEVEL_KEYS = ["layout", "template", "notFound", "error", "loading", "globalError", "forbidden", "unauthorized", "default"];

/** Each level's convention modules, loaded in parallel. */
function loadLevels(levels) {
  return Promise.all(
    levels.map(async (level) => {
      const loaded = await Promise.all(LEVEL_KEYS.map((k) => load(level[k])));
      const mods = { paramNames: level.paramNames, segment: level.segment };
      LEVEL_KEYS.forEach((k, i) => (mods[k] = loaded[i]));
      return mods;
    }),
  );
}

/** What each level's @slots render, loaded: { [levelIndex]: [{ name, Component, mods }] }. */
async function loadSlots(slots) {
  const out = {};
  await Promise.all(
    Object.entries(slots || {}).map(async ([i, list]) => {
      out[i] = await Promise.all(
        list.map(async (s) => ({ name: s.name, Component: (await s.module()).default, mods: await loadLevels(s.levels) })),
      );
    }),
  );
  return out;
}

/** The value useSelectedLayoutSegments reports for a level's folder. */
function segmentValue(segment, params) {
  const m = /^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/.exec(segment || "");
  if (!m) return segment || null;
  const v = params[m[1]];
  return v === undefined ? null : Array.isArray(v) ? v.join("/") : String(v);
}

/** The slot elements a level's layout receives as props. */
function slotProps(slotList, params, props) {
  const out = {};
  for (const slot of slotList || []) {
    let node = slot.Component ? h(slot.Component, props) : null;
    for (let i = slot.mods.length - 1; i >= 0; i--) {
      const m = slot.mods[i];
      if (m.template && m.template.default) node = h(m.template.default, null, node);
      if (m.layout && m.layout.default) node = h(m.layout.default, { params: thenable(params) }, node);
    }
    out[slot.name] = node;
  }
  return out;
}

/**
 * Wrap node in levels[0..upTo]'s layouts, templates and boundaries,
 * innermost first. withBoundaries=false leaves out the boundaries of
 * level upTo itself (a fallback already rendered there). slots are the
 * loaded @slots per level (their elements become layout props).
 */
function wrapLevels(node, mods, upTo, params, pathname, { boundariesAtLeaf = true, slots = {}, pageProps } = {}) {
  const segments = mods.map((m) => segmentValue(m.segment, params));
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
      const own = { params: thenable(pickParams(params, m.paramNames)) };
      node = h(m.layout.default, { ...own, ...slotProps(slots[i], params, pageProps || own) }, node);
    }
    node = h(LayoutSegments, { segments: segments.slice(i + 1).filter((s) => s !== null) }, node);
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

// What React throws from use() on a pending promise: the component renders again later.
const isSuspenseException = (err) =>
  !!err && typeof err.message === "string" && err.message.startsWith("Suspense Exception");

const isNavigationError = (err) => !!(parseRedirectError(err) || httpFallbackStatus(err));

/**
 * Tell instrumentation's onRequestError about an error while handling the
 * current request (once per error). routeType is "render" or "route".
 */
function reportError(err, routeType) {
  const store = globalThis.__VINEXT_SSR_ALS__.getStore();
  const report = globalThis.__VINEXT_REPORT_REQUEST_ERROR__;
  if (!store || !store.request || typeof report !== "function") return;
  if (err && typeof err === "object") {
    if ((store.reported ||= new WeakSet()).has(err)) return;
    store.reported.add(err);
  }
  const { request, routePath } = store;
  const url = new URL(request.url);
  report(err, { url: url.pathname + url.search, method: request.method, headers: Object.fromEntries(request.headers) }, {
    routerKind: "App Router",
    routePath: routePath || url.pathname,
    routeType,
  });
}

/** The RSC stream for a payload; onNavigationError hears notFound()/redirect() thrown while rendering. */
function renderRsc(payload, isRsc, onNavigationError, temporaryReferences) {
  return renderToReadableStream(payload, {
    temporaryReferences,
    onError(err) {
      if (isNavigationError(err)) {
        if (onNavigationError) onNavigationError(err);
        return err.digest;
      }
      if (isSuspenseException(err)) return;
      reportError(err, "render");
      if (err && typeof err === "object" && typeof err.digest === "string") return err.digest;
      if (!isRsc) console.error(err);
    },
  });
}

async function respond(request, rscStream, status, nav, cacheControl = null) {
  const headers = { vary: "RSC" };
  if (cacheControl) headers["cache-control"] = cacheControl;
  if (request.headers.get("rsc") === "1") {
    return new Response(rscStream, { status, headers: { ...headers, "content-type": RSC_CONTENT_TYPE } });
  }
  const ssr = await import.meta.viteRsc.loadModule("ssr", "index");
  const html = await ssr.renderHtml(rscStream, nav);
  return new Response(html, { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
}

/** Whether dynamicParams=false rules params out (they are not in generateStaticParams). */
async function outsideStaticParams(segmentMods, params) {
  for (const mod of segmentMods) {
    if (!mod || typeof mod.generateStaticParams !== "function") continue;
    if (!inStaticParams(await mod.generateStaticParams({ params }), params)) return true;
  }
  return false;
}

/** A promise that resolves once stream has been read to its end (or failed). */
function drained(stream) {
  return (async () => {
    const reader = stream.getReader();
    try {
      while (!(await reader.read()).done);
    } catch {}
  })();
}

async function renderPage(request, url, match, { formState } = {}) {
  const pathname = url.pathname;
  const params = match ? match.params : {};
  const route = match ? match.route : null;
  const levels = route ? route.levels : [rootLevel];
  const mods = await loadLevels(levels);
  const nav = { pathname, search: url.search.slice(1), params, formState };
  const searchParams = searchToObject(url.searchParams);
  const isRsc = request.headers.get("rsc") === "1";
  const renderFallback = (status, from, meta) =>
    respond(
      request,
      renderRsc({ tree: fallbackTree(status, mods, from, params, pathname, meta), params, formState }, isRsc),
      status,
      nav,
      pageCacheControl({}, { status }),
    );

  if (!route) {
    return renderFallback(404, 0, await headElements(mods, params, searchParams));
  }

  const pageMod = await route.module();
  const Page = pageMod.default;
  const segmentMods = [...mods.map((m) => m.layout), pageMod];
  const config = segmentConfig(segmentMods);
  const store = globalThis.__VINEXT_SSR_ALS__.getStore().appRequest;
  const cacheControl = () => pageCacheControl(config, { status: 200, dynamicUsed: store.dynamicUsed });
  if (!config.dynamicParams && (await outsideStaticParams(segmentMods, params))) {
    return renderFallback(404, mods.length - 1, await headElements(mods, params, searchParams));
  }
  const props = { params: thenable(params), searchParams: thenable(searchParams) };
  const leafIndex = mods.length - 1;
  let meta = [];
  let metadataError = null;
  try {
    meta = await headElements(mods, params, searchParams, pageMod);
  } catch (err) {
    const redirect = parseRedirectError(err);
    if (redirect) return redirectResponse(redirect);
    const status = httpFallbackStatus(err);
    if (status) return renderFallback(status, leafIndex, meta);
    // generateMetadata failed: the page's segment fails with its error, for
    // the error boundaries around it to catch.
    metadataError = err;
  }

  // The response status waits for the page itself (it runs once, inside
  // the render): a notFound() or redirect() thrown by it or its layouts
  // answers 404 / 307 instead of a streamed boundary. Under a loading.tsx
  // the page streams, as in Next.js.
  const waitForPage =
    !metadataError && typeof Page === "function" && !isClientReference(Page) && !mods.some((m) => m.loading);
  let settle = () => {};
  const pageSettled = new Promise((resolve) => (settle = resolve));
  let leaf = null;
  if (waitForPage) {
    // A plain (not async) component calling the page in its own render, so
    // hooks such as use() work; an async page's promise is returned as is.
    const finish = (err) => settle(isNavigationError(err) ? err : null);
    leaf = h(function PageRunner() {
      let out;
      try {
        out = Page(props);
      } catch (err) {
        if (!isSuspenseException(err)) finish(err);
        throw err;
      }
      if (out && typeof out.then === "function") {
        return out.then(
          (value) => (finish(null), value),
          (err) => {
            finish(err);
            throw err;
          },
        );
      }
      finish(null);
      return out;
    });
  } else if (metadataError) {
    leaf = h(function MetadataError() {
      throw metadataError;
    });
  } else if (Page) {
    leaf = h(Page, props);
  }
  const slots = await loadSlots(route.slots);
  const tree = wrapLevels(h(Fragment, null, ...meta, leaf), mods, leafIndex, params, pathname, { slots, pageProps: props });
  const stream = renderRsc({ tree, params, formState }, isRsc, (err) => settle(err));
  if (!waitForPage) return respond(request, stream, 200, nav, cacheControl());

  const [out, watch] = stream.tee();
  const navError = await Promise.race([pageSettled, drained(watch).then(() => null)]);
  if (navError) {
    out.cancel().catch(() => {});
    const redirect = parseRedirectError(navError);
    if (redirect) return redirectResponse(redirect);
    return renderFallback(httpFallbackStatus(navError), leafIndex, meta);
  }
  return respond(request, out, 200, nav, cacheControl());
}

/**
 * A server action. Called from the browser (ACTION_HEADER names it) it
 * answers its return value as an RSC payload, with redirect when it called
 * redirect() and revalidated when it revalidated a path or tag or set a
 * cookie (the browser then refreshes the page). A <form action={action}>
 * submitted without JavaScript runs it and renders the page again with its
 * form state.
 */
async function handleAction(request, url, match, store) {
  const actionId = request.headers.get(ACTION_HEADER);
  store.phase = "action";
  if (actionId) {
    const contentType = request.headers.get("content-type") || "";
    const body = contentType.startsWith("multipart/form-data") ? await request.formData() : await request.text();
    const temporaryReferences = createTemporaryReferenceSet();
    const args = await decodeReply(body, { temporaryReferences });
    const action = await loadServerAction(actionId);
    let returnValue = null;
    let redirect = null;
    try {
      returnValue = { ok: true, data: await action.apply(null, args) };
    } catch (err) {
      redirect = parseRedirectError(err);
      if (!redirect) {
        if (!httpFallbackStatus(err)) console.error(err);
        returnValue = { ok: false, data: err };
      }
    }
    store.phase = "render";
    const revalidated = !!store.revalidated || store.setCookies.size > 0;
    const stream = renderRsc({ returnValue, redirect, revalidated }, true, null, temporaryReferences);
    return new Response(stream, { headers: { "content-type": RSC_CONTENT_TYPE, vary: "RSC" } });
  }

  const formData = await request.formData();
  const action = await decodeAction(formData);
  store.phase = "render";
  if (!action) return renderPage(request, url, match);
  store.phase = "action";
  let result;
  try {
    result = await action();
  } catch (err) {
    const redirect = parseRedirectError(err);
    if (redirect) return new Response(null, { status: 303, headers: { location: redirect.url } });
    throw err;
  }
  const formState = await decodeFormState(result, formData);
  store.phase = "render";
  return renderPage(request, url, match, { formState });
}

const isActionRequest = (request) => {
  if (request.method !== "POST") return false;
  if (request.headers.get(ACTION_HEADER)) return true;
  const type = request.headers.get("content-type") || "";
  return type.startsWith("multipart/form-data") || type.startsWith("application/x-www-form-urlencoded");
};

// Reading the request (its headers, URL, cookies or body) makes a route
// handler dynamic, as headers() and cookies() do: it is not cacheable.
const REQUEST_READS = new Set(["headers", "url", "nextUrl", "cookies", "body", "json", "text", "formData", "arrayBuffer", "blob", "bytes"]);

function trackRequestReads(request, store) {
  return new Proxy(request, {
    get(target, prop) {
      if (REQUEST_READS.has(prop)) store.dynamicUsed = true;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function handleRoute(request, match, store) {
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
    response = await fn(trackRequestReads(new NextRequest(request), store), { params: thenable(match.params) });
  } catch (err) {
    const redirect = parseRedirectError(err);
    if (redirect) return redirectResponse(redirect);
    const status = httpFallbackStatus(err);
    if (status) return new Response(null, { status });
    console.error(err);
    reportError(err, "route");
    return new Response(null, { status: 500 });
  }
  if (!(response instanceof Response)) {
    console.error(new Error(`No response is returned from route handler '${match.route.pattern}'.`));
    return new Response(null, { status: 500 });
  }
  const headers = new Headers(response.headers);
  if (
    (method === "GET" || method === "HEAD") &&
    mod.dynamic !== "force-dynamic" &&
    !store.dynamicUsed &&
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
    store.request = request;
    const url = new URL(request.url);
    const metadataRoute = metadataRoutes.find((r) => r.path === url.pathname);
    if (metadataRoute) return metadataRouteResponse(metadataRoute.type, await metadataRoute.module());
    const match = matchRoute(routes, url.pathname);
    if (match) store.routePath = match.route.pattern;
    let response;
    if (match && match.route.kind === "route") {
      store.appRequest.phase = "route";
      response = await handleRoute(request, match, store.appRequest);
    } else if (isActionRequest(request)) {
      response = await handleAction(request, url, match, store.appRequest);
    } else {
      store.appRequest.phase = "render";
      response = await renderPage(request, url, match);
    }
    return withCookies(response, takeSetCookies(store.appRequest));
  });
}
