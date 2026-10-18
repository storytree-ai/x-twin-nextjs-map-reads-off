// The App Router's browser entry: hydrate the document from the RSC payload
// the HTML inlined, then navigate client-side. A navigation fetches the
// next URL's RSC payload (header RSC: 1) and swaps the tree in a
// transition; history and scroll follow once it commits.
import { createElement as h, startTransition, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { createFromFetch, createFromReadableStream } from "@vitejs/plugin-rsc/browser";
import { AppNavContext } from "../shims/app-nav-context.js";

/** The inline flight chunks (see flight-inline.js) as a byte stream. */
function readInlineFlight() {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const chunks = (self.__vinext_f ||= []);
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      chunks.length = 0;
      chunks.push = (c) => {
        controller.enqueue(encoder.encode(c));
        return 0;
      };
      const close = () => controller.close();
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", close);
      else close();
    },
  });
}

const currentUrl = () => window.location.pathname + window.location.search;

let navigate = null; // set by AppRouter once mounted
let navId = 0;
let applyingHistory = false;

const router = {
  push: (href, opts) => navigate(href, { mode: "push", scroll: !opts || opts.scroll !== false }),
  replace: (href, opts) => navigate(href, { mode: "replace", scroll: !opts || opts.scroll !== false }),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => navigate(currentUrl(), { mode: "refresh", scroll: false }),
  prefetch: () => {},
};

function hardNavigate(href) {
  window.location.href = href;
}

function AppRouter({ initialPayload }) {
  const [state, setState] = useState(() => ({ payload: initialPayload, url: currentUrl(), commit: null }));

  useEffect(() => {
    navigate = async (href, { mode, scroll }) => {
      const target = new URL(href, window.location.href);
      if (target.origin !== window.location.origin) return hardNavigate(target.href);
      const id = ++navId;
      let response;
      try {
        response = await fetch(target.pathname + target.search, { headers: { RSC: "1" } });
      } catch {
        return hardNavigate(target.href);
      }
      if (id !== navId) return;
      // Not an App Router page (a Pages Router page, an asset): load it.
      if (!(response.headers.get("content-type") || "").includes("text/x-component")) {
        return hardNavigate(response.redirected ? response.url : target.href);
      }
      const finalUrl = response.redirected ? new URL(response.url) : target;
      const payload = await createFromFetch(Promise.resolve(response));
      if (id !== navId) return;
      const url = finalUrl.pathname + finalUrl.search;
      const commit = { id, mode, url: url + target.hash, scroll, hash: target.hash };
      startTransition(() => setState({ payload, url, commit }));
    };

    const onPopState = () => {
      navigate(window.location.href, { mode: "pop", scroll: false });
    };
    window.addEventListener("popstate", onPopState);

    // pushState/replaceState called by the app itself update the hooks'
    // URL without fetching, as in Next.js.
    const original = { pushState: window.history.pushState, replaceState: window.history.replaceState };
    for (const name of ["pushState", "replaceState"]) {
      window.history[name] = function (data, unused, url) {
        original[name].call(window.history, data, unused, url);
        if (!applyingHistory && url != null) {
          setState((s) => (s.url === currentUrl() ? s : { ...s, url: currentUrl(), commit: null }));
        }
      };
    }

    window.__VINEXT_APP_ROUTER__ = router;
    if (import.meta.hot) {
      import.meta.hot.on("rsc:update", () => router.refresh());
    }
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.history.pushState = original.pushState;
      window.history.replaceState = original.replaceState;
      delete window.__VINEXT_APP_ROUTER__;
    };
  }, []);

  useLayoutEffect(() => {
    const c = state.commit;
    if (!c) return;
    applyingHistory = true;
    try {
      if (c.mode === "push") window.history.pushState({ __vinext: c.id }, "", c.url);
      else if (c.mode === "replace") window.history.replaceState({ __vinext: c.id }, "", c.url);
    } finally {
      applyingHistory = false;
    }
    if (c.scroll) {
      const el = c.hash && document.getElementById(decodeURIComponent(c.hash.slice(1)));
      if (el) el.scrollIntoView();
      else window.scrollTo(0, 0);
    }
  }, [state.commit]);

  const { pathname, search } = useMemo(() => {
    const u = new URL(state.url, window.location.origin);
    return { pathname: u.pathname, search: u.search.slice(1) };
  }, [state.url]);
  const value = useMemo(
    () => ({ pathname, search, params: state.payload.params, router }),
    [pathname, search, state.payload],
  );
  return h(AppNavContext.Provider, { value }, state.payload.tree);
}

async function main() {
  const initialPayload = await createFromReadableStream(readInlineFlight());
  hydrateRoot(document, h(AppRouter, { initialPayload }));
}

main();
