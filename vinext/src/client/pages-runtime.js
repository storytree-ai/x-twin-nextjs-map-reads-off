// Browser runtime for the Pages Router: hydrates #__next with _app and the
// page from __NEXT_DATA__, then lets next/router swap pages in place.
import { createElement, useLayoutEffect, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { _initClientRouter } from "../shims/router.js";
import { setClientRouterState } from "../shims/router-state.js";
import DefaultApp from "../shims/app.js";
import { createPatternMatcher } from "./route-matcher.js";

export async function startPagesClient({ pages, patterns, loadApp }) {
  const dataEl = document.getElementById("__NEXT_DATA__");
  const data = JSON.parse(dataEl ? dataEl.textContent : "{}");
  window.__NEXT_DATA__ = data;
  const loadPage = (pattern) => {
    const load = pages[pattern];
    if (!load) throw new Error(`[vinext] no page module for ${pattern}`);
    return load();
  };
  if (!pages[data.page]) {
    console.error("[vinext] no page module for", data.page);
    return;
  }

  // The page swap is a default-priority update resolved once it commits:
  // the old page's effect cleanups (its router.events listeners) run
  // after routeChangeComplete, as in Next.js.
  let setPage = null;
  let committed = null;

  const router = _initClientRouter(
    {
      pathname: data.page,
      query: data.query || {},
      asPath: window.location.pathname + window.location.search,
    },
    {
      loadPage,
      matchPattern: createPatternMatcher(patterns),
      render(page, state) {
        return new Promise((resolve) => {
          setClientRouterState(state, { silent: true });
          if (committed) committed();
          committed = resolve;
          setPage(page);
        });
      },
    },
  );

  const [pageMod, appMod] = await Promise.all([loadPage(data.page), loadApp ? loadApp() : null]);
  const App = (appMod && appMod.default) || DefaultApp;
  const appProps = { ...(data.props || {}) };
  delete appProps.pageProps;
  const initial = { Component: pageMod.default, pageProps: (data.props && data.props.pageProps) || {} };

  function PagesRoot() {
    const [page, set] = useState(initial);
    setPage = set;
    useLayoutEffect(() => {
      if (committed) {
        const done = committed;
        committed = null;
        done();
      }
    }, [page]);
    return createElement(App, { ...appProps, Component: page.Component, pageProps: page.pageProps, router });
  }

  window.__VINEXT_ROOT__ = hydrateRoot(document.getElementById("__next"), createElement(PagesRoot));
}
