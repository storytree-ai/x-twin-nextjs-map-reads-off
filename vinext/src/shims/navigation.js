// next/navigation hooks for client components. Under the App Router they
// read its navigation state (AppNavContext, provided by the SSR entry and
// the browser's app router); in a Pages Router app they fall back to the
// shared next/router state.
import { useContext, useMemo } from "react";
import { useRouterState } from "./router-state.js";
import Router from "./router.js";
import { AppNavContext } from "./app-nav-context.js";
import { ReadonlyURLSearchParams } from "./navigation-shared.js";

export * from "./navigation-shared.js";

function pagesSearch(asPath) {
  return asPath.split("#")[0].split("?")[1] || "";
}

export function usePathname() {
  const app = useContext(AppNavContext);
  const pages = useRouterState();
  return app ? app.pathname : pages.asPath.split(/[?#]/)[0];
}

export function useSearchParams() {
  const app = useContext(AppNavContext);
  const pages = useRouterState();
  const search = app ? app.search : pagesSearch(pages.asPath);
  return useMemo(() => new ReadonlyURLSearchParams(search), [search]);
}

export function useParams() {
  const app = useContext(AppNavContext);
  const pages = useRouterState();
  return app ? app.params : pages.query;
}

const pagesRouter = {
  push: (href) => Router.push(href),
  replace: (href) => Router.replace(href),
  back: () => Router.back(),
  forward: () => Router.forward(),
  refresh: () => Router.reload(),
  prefetch: () => Promise.resolve(),
};

export function useRouter() {
  const app = useContext(AppNavContext);
  return app ? app.router : pagesRouter;
}

export function useSelectedLayoutSegment() {
  return null;
}

export function useSelectedLayoutSegments() {
  return [];
}
