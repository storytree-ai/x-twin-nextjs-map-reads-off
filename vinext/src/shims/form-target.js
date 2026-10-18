// Where a next/form GET submission navigates (no React, so it is unit tested).

/**
 * The URL a GET submission navigates to, or null when the browser should
 * submit it: action/method are the form's, submitter's formAction /
 * formMethod (when set) override them, entries are the form data's.
 */
export function formGetTarget({ action, method, submitter, entries, base }) {
  const target = (submitter && submitter.formAction) || action;
  const verb = ((submitter && submitter.formMethod) || method || "GET").toUpperCase();
  if (verb !== "GET" || typeof target !== "string") return null;
  const url = new URL(target, base);
  if (url.origin !== new URL(base).origin) return null;
  const query = new URLSearchParams();
  for (const [k, v] of entries) {
    if (typeof v !== "string") return null;
    query.append(k, v);
  }
  url.search = query.toString();
  return url.pathname + url.search;
}
