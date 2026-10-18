// The page a client navigation leaves (sent as x-vinext-from, so the server
// can apply intercepting routes). A history entry vinext pushes keeps the
// page it was reached from, so going back or forward to an intercepted URL
// (or refreshing it) shows the intercepted view again, as in Next.js.

/** The history state for an entry reached from the page `from`. */
export function historyState(id, from) {
  return { __vinext: id, __vinextFrom: from };
}

/** The pathname a navigation of `mode` to `targetPath` leaves. */
export function navigationSource(mode, targetPath, currentPath, state) {
  if (mode === "pop" || mode === "refresh") {
    return state && typeof state.__vinextFrom === "string" ? state.__vinextFrom : targetPath;
  }
  return currentPath;
}
