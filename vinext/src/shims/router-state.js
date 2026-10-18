// Shared Pages Router state behind next/router, next/compat/router and
// next/navigation. The server sets it per request (setSSRContext) before
// rendering; the browser sets it from __NEXT_DATA__ before hydrating.
import { useSyncExternalStore } from "react";

const isServer = typeof window === "undefined";

let ssrState = null;
let clientState = null;
const listeners = new Set();

function emptyState() {
  return { pathname: "/", query: {}, asPath: "/", isFallback: false };
}

// The dev server renders each request inside an AsyncLocalStorage it keeps
// on globalThis (server/ssr-context.js), so concurrent renders keep their
// own router state; ssrState is the fallback outside one.
function requestStore() {
  const als = globalThis.__VINEXT_SSR_ALS__;
  return als ? als.getStore() : undefined;
}

export function getRouterState() {
  if (isServer) {
    const store = requestStore();
    return (store && store.router) || ssrState || emptyState();
  }
  return clientState || emptyState();
}

export function setSSRContext(ctx) {
  const state = ctx ? { ...emptyState(), ...ctx } : null;
  const store = requestStore();
  if (store) store.router = state;
  else ssrState = state;
}

/**
 * Update the browser's router state. { silent: true } skips notifying
 * subscribers, for a page swap that re-renders the whole tree anyway
 * (notifyRouterState() catches up memoised readers after it commits).
 */
export function setClientRouterState(next, { silent = false } = {}) {
  clientState = { ...emptyState(), ...clientState, ...next };
  if (!silent) notifyRouterState();
}

export function notifyRouterState() {
  for (const l of [...listeners]) l();
}

export function subscribeRouterState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRouterState() {
  return useSyncExternalStore(subscribeRouterState, getRouterState, getRouterState);
}

/** A tiny event emitter matching next/router's `Router.events` (mitt). */
export function createEmitter() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },
    off(type, fn) {
      handlers.get(type)?.delete(fn);
    },
    emit(type, ...args) {
      for (const fn of [...(handlers.get(type) || [])]) fn(...args);
    },
  };
}
