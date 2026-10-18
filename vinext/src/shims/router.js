// next/router for the Pages Router. Navigation here is a full page load;
// client-side transitions replace navigate() in a later increment.
import { createElement, useMemo } from "react";
import {
  createEmitter,
  getRouterState,
  setClientRouterState,
  setSSRContext,
  useRouterState,
} from "./router-state.js";

export { setSSRContext };

const events = createEmitter();
let beforePopStateCallback = null;

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
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((x) => search.append(k, String(x)));
    else if (v !== undefined && v !== null) search.append(k, String(v));
  }
  const qs = search.toString();
  return pathname + (qs ? `?${qs}` : "") + (url.hash ? `#${String(url.hash).replace(/^#/, "")}` : "");
}

function navigate(url, as, replace) {
  if (typeof window === "undefined") return Promise.resolve(false);
  const target = as !== undefined ? urlToString(as) : urlToString(url);
  if (replace) window.location.replace(target);
  else window.location.assign(target);
  return Promise.resolve(true);
}

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
    push: (url, as, options) => navigate(url, as, false, options),
    replace: (url, as, options) => navigate(url, as, true, options),
    back: () => typeof window !== "undefined" && window.history.back(),
    forward: () => typeof window !== "undefined" && window.history.forward(),
    reload: () => typeof window !== "undefined" && window.location.reload(),
    prefetch: () => Promise.resolve(),
    beforePopState: (cb) => {
      beforePopStateCallback = cb;
    },
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
  push: (url, as, options) => navigate(url, as, false, options),
  replace: (url, as, options) => navigate(url, as, true, options),
  back: () => typeof window !== "undefined" && window.history.back(),
  forward: () => typeof window !== "undefined" && window.history.forward(),
  reload: () => typeof window !== "undefined" && window.location.reload(),
  prefetch: () => Promise.resolve(),
  beforePopState: (cb) => {
    beforePopStateCallback = cb;
  },
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

/** Browser bootstrap: called by the client entry before hydration. */
export function _initClientRouter(state) {
  setClientRouterState(state);
  if (typeof window !== "undefined") {
    window.next = Object.assign(window.next || {}, { router: Router });
  }
  return Router;
}

export function _getBeforePopState() {
  return beforePopStateCallback;
}

export { urlToString as _urlToString };
export default Router;
