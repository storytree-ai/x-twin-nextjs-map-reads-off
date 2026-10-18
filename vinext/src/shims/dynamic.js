// next/dynamic: lazily loaded components (ssr: false renders the loading
// fallback on the server).
import { createElement, lazy, Suspense, useEffect, useState } from "react";

const preloads = [];

export default function dynamic(loader, options = {}) {
  const opts = typeof loader === "object" && loader.loader ? { ...loader, ...options } : options;
  const load = typeof loader === "function" ? loader : loader.loader;
  const Loading = opts.loading || (() => null);
  const resolve = () =>
    Promise.resolve(load()).then((m) => ({ default: m && m.default !== undefined ? m.default : m }));

  if (opts.ssr === false) {
    function ClientOnly(props) {
      const [Comp, setComp] = useState(null);
      useEffect(() => {
        let live = true;
        resolve().then((m) => live && setComp(() => m.default));
        return () => {
          live = false;
        };
      }, []);
      return Comp ? createElement(Comp, props) : createElement(Loading, { isLoading: true, pastDelay: true, error: null });
    }
    return ClientOnly;
  }

  const Lazy = lazy(() => {
    const p = resolve();
    preloads.push(p);
    return p;
  });
  function DynamicComponent(props) {
    return createElement(
      Suspense,
      { fallback: createElement(Loading, { isLoading: true, pastDelay: true, error: null }) },
      createElement(Lazy, props),
    );
  }
  return DynamicComponent;
}

export function flushPreloads() {
  return Promise.all(preloads.splice(0));
}
