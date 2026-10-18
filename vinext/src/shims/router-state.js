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

export function getRouterState() {
  return (isServer ? ssrState : clientState) || emptyState();
}

export function setSSRContext(ctx) {
  ssrState = ctx ? { ...emptyState(), ...ctx } : null;
}

export function setClientRouterState(next) {
  clientState = { ...emptyState(), ...clientState, ...next };
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
