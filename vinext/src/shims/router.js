// next/router for the Pages Router. In the browser, push/replace and
// back/forward are client-side transitions: the page's data comes from
// /_next/data/<build>/<path>.json, its module from the client entry's page
// map, and the client entry re-renders _app with it (see
// client/pages-entry.js). Events, shallow routing and beforePopState
// follow Next.js.
import { createElement, useMemo } from "react";
import {
  createEmitter,
  getRouterState,
  notifyRouterState,
  setClientRouterState,
  setSSRContext,
  useRouterState,
} from "./router-state.js";
import { createPatternMatcher } from "../client/route-matcher.js";

export { setSSRContext };

const isBrowser = typeof window !== "undefined";
const events = createEmitter();
let beforePopStateCallback = null;
// Set by _initClientRouter: loads a page module by route pattern, and
// renders a page ({ Component, pageProps }) into the root.
let client = null;
let navigationId = 0;

/** Fill [param] segments of an href object's pathname from its query. */
function urlToString(url) {
  if (typeof url === "string") return url;
  if (!url || typeof url !== "object") return String(url);
  let pathname = url.pathname || getRouterState().pathname;
  const query = { ...(url.query || {}) };
  pathname = pathname.replace(/\[\[?(?:\.\.\.)?([^\]]+)\]\]?/g, (m, name) => {
    const v = query[name];
    delete query[name];
    return Array.isArray(v) ? v.map(encodeURIComponent).join("/") : encodeURIComponent(v ?? "");
  });
  let qs = "";
  if (typeof url.search === "string" && url.search) qs = url.search.replace(/^\?/, "");
  else {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach((x) => search.append(k, String(x)));
      else if (v !== undefined && v !== null) search.append(k, String(v));
    }
    qs = search.toString();
  }
  return pathname + (qs ? `?${qs}` : "") + (url.hash ? `#${String(url.hash).replace(/^#/, "")}` : "");
}

/** href (string or object) resolved against the current asPath, as a URL. */
function resolveUrl(href) {
  const base = isBrowser ? window.location.href : `http://localhost${getRouterState().asPath}`;
  return new URL(urlToString(href), base);
}

/** A same-origin URL's path + search + hash; the asPath form. */
function toAsPath(u) {
  return u.pathname + u.search + u.hash;
}

/** An href as Link renders it: relative ones resolved against the current path. */
export function resolveHref(href) {
  const s = urlToString(href);
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(s) || s.startsWith("/")) return s;
  const u = resolveUrl(s);
  return toAsPath(u);
}

function isLocal(u) {
  return !isBrowser || u.origin === window.location.origin;
}

function searchQuery(search) {
  const entries = new Map();
  for (const [k, v] of new URLSearchParams(search)) {
    entries.set(k, entries.has(k) ? [].concat(entries.get(k), v) : v);
  }
  return Object.fromEntries(entries);
}

/** The names of a route pattern's params ("/docs/[...slug]" → ["slug"]). */
function routeParamNames(pattern) {
  return [...String(pattern || "").matchAll(/\[\[?(?:\.\.\.)?([^\]]+)\]\]?/g)].map((m) => m[1]);
}

/** A router query: search params, with the route's own params winning. */
function buildQuery(pattern, search, params) {
  const query = searchQuery(search);
  for (const name of routeParamNames(pattern)) {
    if (params && params[name] !== undefined) query[name] = params[name];
  }
  return query;
}

function dataUrl(u) {
  const buildId = (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) || "development";
  const path = u.pathname === "/" ? "/index" : u.pathname.replace(/\/$/, "");
  return `/_next/data/${buildId}${path}.json${u.search}`;
}

function hardNavigate(asPath, replace) {
  if (replace) window.location.replace(asPath);
  else window.location.assign(asPath);
}

function cancelledError(asPath) {
  const err = new Error(`Abort fetching component for route: "${asPath}"`);
  err.cancelled = true;
  return err;
}

function scrollAfterNavigation(u, scroll) {
  if (scroll === false) return;
  if (u.hash) {
    const id = decodeURIComponent(u.hash.slice(1));
    const el = document.getElementById(id) || document.getElementsByName(id)[0];
    if (el) {
      el.scrollIntoView();
      return;
    }
  }
  window.scrollTo(0, 0);
}

function writeHistory(method, url, asPath, options) {
  if (method === "none") return;
  const state = { __N: true, url, as: asPath, options: { shallow: !!options.shallow }, key: Math.random().toString(36).slice(2, 10) };
  window.history[method === "replace" ? "replaceState" : "pushState"](state, "", asPath);
}

function isHashOnlyChange(target) {
  const cur = new URL(getRouterState().asPath, window.location.href);
  return cur.pathname === target.pathname && cur.search === target.search && (target.hash !== "" || cur.hash !== "");
}

/**
 * One client-side transition. method is "push", "replace" or "none"
 * (popstate: the browser already moved). Resolves true when the new page
 * rendered, false when it was cancelled or handed to a full load.
 */
async function change(method, href, as, options = {}) {
  if (!isBrowser) return false;
  const realUrl = resolveUrl(href);
  const shownUrl = as !== undefined ? resolveUrl(as) : realUrl;
  if (!isLocal(shownUrl)) {
    hardNavigate(shownUrl.href, method === "replace");
    return false;
  }
  const asPath = toAsPath(shownUrl);
  const state = getRouterState();
  if (!client) {
    // No Pages Router client on this document: a full load.
    hardNavigate(asPath, method === "replace");
    return false;
  }
  const routeOptions = { shallow: !!options.shallow };

  // A hash-only change re-renders nothing.
  if (method !== "none" && isHashOnlyChange(shownUrl) && !options._popstate) {
    events.emit("hashChangeStart", asPath, routeOptions);
    writeHistory(method, toAsPath(realUrl), asPath, options);
    setClientRouterState({ asPath });
    scrollAfterNavigation(shownUrl, options.scroll === false ? false : shownUrl.hash ? true : false);
    events.emit("hashChangeComplete", asPath, routeOptions);
    return true;
  }

  const id = ++navigationId;
  events.emit("routeChangeStart", asPath, routeOptions);

  // Shallow: same page, new URL and query, no data fetching.
  const target = options.shallow ? client.matchPattern(realUrl.pathname) : null;
  if (target && target.pattern === state.pathname) {
    events.emit("beforeHistoryChange", asPath, routeOptions);
    writeHistory(method, toAsPath(realUrl), asPath, options);
    setClientRouterState({ asPath, query: buildQuery(target.pattern, realUrl.search, target.params) });
    scrollAfterNavigation(shownUrl, options.scroll === false ? false : undefined);
    events.emit("routeChangeComplete", asPath, routeOptions);
    return true;
  }

  // Masked hrefs ({ pathname: "/posts/[id]" } with as) that cannot be
  // filled from their own query are fetched by their `as`.
  const fetchUrl = /\[|%5B/i.test(realUrl.pathname) ? shownUrl : realUrl;
  let data;
  try {
    const res = await fetch(dataUrl(fetchUrl), { headers: { "x-nextjs-data": "1" } });
    const type = res.headers.get("content-type") || "";
    data = type.includes("application/json") ? await res.json() : null;
    if (!res.ok && !(data && data.page)) data = null;
  } catch {
    data = null;
  }
  if (id !== navigationId) {
    events.emit("routeChangeError", cancelledError(asPath), asPath, routeOptions);
    return false;
  }
  if (!data || data.notFound) {
    hardNavigate(asPath, method === "replace");
    return false;
  }
  if (data.redirect) {
    const dest = resolveUrl(data.redirect);
    if (!isLocal(dest)) {
      hardNavigate(dest.href, true);
      return false;
    }
    return change(method, toAsPath(dest), undefined, options);
  }

  let pageMod;
  try {
    pageMod = await client.loadPage(data.page);
  } catch (err) {
    console.error(err);
    pageMod = null;
  }
  if (id !== navigationId) {
    events.emit("routeChangeError", cancelledError(asPath), asPath, routeOptions);
    return false;
  }
  if (!pageMod) {
    hardNavigate(asPath, method === "replace");
    return false;
  }

  events.emit("beforeHistoryChange", asPath, routeOptions);
  writeHistory(method, toAsPath(fetchUrl), asPath, options);
  const query = buildQuery(data.page, fetchUrl.search, data.query);
  if (window.__NEXT_DATA__) Object.assign(window.__NEXT_DATA__, { page: data.page, query: data.query, props: data.props });
  const pageProps = (data.props && data.props.pageProps) || {};
  await client.render({ Component: pageMod.default, pageProps }, { pathname: data.page, query, asPath });
  notifyRouterState();
  scrollAfterNavigation(shownUrl, options.scroll);
  events.emit("routeChangeComplete", asPath, routeOptions);
  return true;
}

function onPopState(e) {
  const state = e.state;
  const asPath = toAsPath(window.location);
  if (state && !state.__N) return;
  if (beforePopStateCallback) {
    const info = state ? { url: state.url, as: state.as, options: state.options } : { url: asPath, as: asPath, options: {} };
    if (!beforePopStateCallback(info)) return;
  }
  const cur = new URL(getRouterState().asPath, window.location.href);
  if (cur.pathname === window.location.pathname && cur.search === window.location.search) {
    // Back or forward between hashes of one page.
    if (cur.hash === window.location.hash) return;
    events.emit("hashChangeStart", asPath, { shallow: false });
    setClientRouterState({ asPath });
    events.emit("hashChangeComplete", asPath, { shallow: false });
    return;
  }
  change("none", state ? state.url : asPath, state ? state.as : asPath, {
    shallow: !!(state && state.options && state.options.shallow),
    _popstate: true,
  });
}

/** Re-read router state from the URL and __NEXT_DATA__ (the vinext:navigate event). */
function onVinextNavigate() {
  const data = window.__NEXT_DATA__ || {};
  const pattern = data.page || getRouterState().pathname;
  // Route params from the URL when it fits the page's pattern, else from __NEXT_DATA__.
  const fromUrl = createPatternMatcher([pattern])(window.location.pathname);
  setClientRouterState({
    pathname: pattern,
    query: buildQuery(pattern, window.location.search, fromUrl ? fromUrl.params : data.query),
    asPath: toAsPath(window.location),
  });
}

const push = (url, as, options) => change("push", url, as, options);
const replace = (url, as, options) => change("replace", url, as, options);
const back = () => isBrowser && window.history.back();
const forward = () => isBrowser && window.history.forward();
const reload = () => isBrowser && window.location.reload();
const prefetch = () => Promise.resolve();
const beforePopState = (cb) => {
  beforePopStateCallback = cb;
};

function makeRouter(state) {
  return {
    pathname: state.pathname,
    route: state.pathname,
    query: state.query,
    asPath: state.asPath,
    basePath: "",
    locale: state.locale,
    locales: state.locales,
    defaultLocale: state.defaultLocale,
    isReady: true,
    isPreview: false,
    isFallback: !!state.isFallback,
    isLocaleDomain: false,
    push,
    replace,
    back,
    forward,
    reload,
    prefetch,
    beforePopState,
    events,
  };
}

export function useRouter() {
  const state = useRouterState();
  return useMemo(() => makeRouter(state), [state]);
}

/** The singleton `Router` (default export), always reading current state. */
const Router = {
  get pathname() {
    return getRouterState().pathname;
  },
  get route() {
    return getRouterState().pathname;
  },
  get query() {
    return getRouterState().query;
  },
  get asPath() {
    return getRouterState().asPath;
  },
  get basePath() {
    return "";
  },
  get isReady() {
    return true;
  },
  get isFallback() {
    return !!getRouterState().isFallback;
  },
  push,
  replace,
  back,
  forward,
  reload,
  prefetch,
  beforePopState,
  events,
  get router() {
    return Router;
  },
  ready(cb) {
    cb();
  },
};

export function withRouter(Component) {
  function WithRouter(props) {
    return createElement(Component, { ...props, router: useRouter() });
  }
  WithRouter.displayName = `withRouter(${Component.displayName || Component.name || "Component"})`;
  return WithRouter;
}

export function createRouter() {
  return Router;
}

/**
 * Browser bootstrap, called by the client entry before hydration with the
 * initial state and { loadPage(pattern), matchPattern(pathname) → { pattern, params },
 * render(page, state) → Promise }.
 */
export function _initClientRouter(state, hooks) {
  setClientRouterState(state);
  if (!isBrowser) return Router;
  client = hooks || null;
  window.next = Object.assign(window.next || {}, { router: Router });
  if (!window.__VINEXT_ROUTER_LISTENING__) {
    window.__VINEXT_ROUTER_LISTENING__ = true;
    window.history.scrollRestoration = "manual";
    window.addEventListener("popstate", onPopState);
    window.addEventListener("vinext:navigate", onVinextNavigate);
  }
  const cur = window.history.state;
  if (!cur || !cur.__N) {
    const asPath = toAsPath(window.location);
    window.history.replaceState({ __N: true, url: asPath, as: asPath, options: {}, key: "initial" }, "", asPath);
  }
  return Router;
}

export function _getBeforePopState() {
  return beforePopStateCallback;
}

export { urlToString as _urlToString };
export default Router;
