// The parts of next/navigation that hold no React state, shared by the
// client build (navigation.js) and the react-server build
// (navigation.react-server.js): ReadonlyURLSearchParams and the
// navigation errors server code throws (redirect, notFound, ...).

class ReadonlyURLSearchParamsError extends Error {
  constructor() {
    super(
      "Method unavailable on `ReadonlyURLSearchParams`. Read more: https://nextjs.org/docs/app/api-reference/functions/use-search-params#updating-searchparams",
    );
  }
}

export class ReadonlyURLSearchParams extends URLSearchParams {
  append() {
    throw new ReadonlyURLSearchParamsError();
  }
  delete() {
    throw new ReadonlyURLSearchParamsError();
  }
  set() {
    throw new ReadonlyURLSearchParamsError();
  }
  sort() {
    throw new ReadonlyURLSearchParamsError();
  }
}

export const RedirectType = { push: "push", replace: "replace" };

function navError(digest, message) {
  const err = new Error(message);
  err.digest = digest;
  return err;
}

// Inside a server action redirect() pushes a history entry, elsewhere it replaces.
function defaultRedirectType() {
  const als = globalThis.__VINEXT_SSR_ALS__;
  const store = als && als.getStore();
  return store && store.appRequest && store.appRequest.phase === "action" ? "push" : "replace";
}

export function redirect(url, type = defaultRedirectType()) {
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

/** { url, type, status } of a redirect() error, or null. */
export function parseRedirectError(err) {
  const digest = err && typeof err === "object" ? err.digest : undefined;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  const parts = digest.split(";");
  return { type: parts[1], url: parts.slice(2, -2).join(";"), status: Number(parts[parts.length - 2]) || 307 };
}

/** The HTTP status of a notFound()/forbidden()/unauthorized() error, or null. */
export function httpFallbackStatus(err) {
  const digest = err && typeof err === "object" ? err.digest : undefined;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;")) return null;
  return Number(digest.split(";")[1]) || null;
}

/** Re-throw Next.js's internal navigation errors, as unstable_rethrow does. */
export function unstable_rethrow(err) {
  if (parseRedirectError(err) || httpFallbackStatus(err)) throw err;
}
