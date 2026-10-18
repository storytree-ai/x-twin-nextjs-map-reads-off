// next/navigation hooks over the shared router state (the App Router
// increment gives them their own source).
import { useMemo } from "react";
import { useRouterState } from "./router-state.js";
import Router from "./router.js";

export class ReadonlyURLSearchParams extends URLSearchParams {
  append() {
    throw new Error("ReadonlyURLSearchParams cannot be modified");
  }
  delete() {
    throw new Error("ReadonlyURLSearchParams cannot be modified");
  }
  set() {
    throw new Error("ReadonlyURLSearchParams cannot be modified");
  }
  sort() {
    throw new Error("ReadonlyURLSearchParams cannot be modified");
  }
}

export function usePathname() {
  return useRouterState().asPath.split(/[?#]/)[0];
}

export function useSearchParams() {
  const { asPath } = useRouterState();
  return useMemo(() => new ReadonlyURLSearchParams(asPath.split("#")[0].split("?")[1] || ""), [asPath]);
}

export function useParams() {
  return useRouterState().query;
}

export function useRouter() {
  return useMemo(
    () => ({
      push: (href) => Router.push(href),
      replace: (href) => Router.replace(href),
      back: () => Router.back(),
      forward: () => Router.forward(),
      refresh: () => Router.reload(),
      prefetch: () => {},
    }),
    [],
  );
}

export function useSelectedLayoutSegment() {
  return null;
}

export function useSelectedLayoutSegments() {
  return [];
}

function navError(digest, message) {
  const err = new Error(message);
  err.digest = digest;
  return err;
}

export function redirect(url, type = "replace") {
  throw navError(`NEXT_REDIRECT;${type};${url};307;`, "NEXT_REDIRECT");
}

export function permanentRedirect(url, type = "replace") {
  throw navError(`NEXT_REDIRECT;${type};${url};308;`, "NEXT_REDIRECT");
}

export function notFound() {
  throw navError("NEXT_HTTP_ERROR_FALLBACK;404", "NEXT_NOT_FOUND");
}

export function forbidden() {
  throw navError("NEXT_HTTP_ERROR_FALLBACK;403", "NEXT_FORBIDDEN");
}

export function unauthorized() {
  throw navError("NEXT_HTTP_ERROR_FALLBACK;401", "NEXT_UNAUTHORIZED");
}
