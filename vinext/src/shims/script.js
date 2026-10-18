// next/script: injects scripts in the browser after hydration.
import { useEffect } from "react";

const loaded = new Set();

export function handleClientScriptLoad(props) {
  if (typeof document === "undefined") return;
  const { src, id, onLoad, onReady, onError, children, dangerouslySetInnerHTML, strategy, ...attrs } = props;
  const key = id || src;
  if (key && loaded.has(key)) {
    if (onReady) onReady();
    return;
  }
  if (key) loaded.add(key);
  const el = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  if (id) el.id = id;
  if (src) el.src = src;
  const inline = dangerouslySetInnerHTML ? dangerouslySetInnerHTML.__html : typeof children === "string" ? children : "";
  if (inline) el.textContent = inline;
  el.addEventListener("load", (e) => {
    if (onLoad) onLoad(e);
    if (onReady) onReady();
  });
  if (onError) el.addEventListener("error", onError);
  document.body.appendChild(el);
  if (!src && onReady) onReady();
}

export function initScriptLoader(scripts) {
  scripts.forEach(handleClientScriptLoad);
}

export default function Script(props) {
  useEffect(() => {
    if (props.strategy === "lazyOnload") {
      const run = () => handleClientScriptLoad(props);
      if (document.readyState === "complete") setTimeout(run, 0);
      else window.addEventListener("load", run, { once: true });
    } else {
      handleClientScriptLoad(props);
    }
  }, []);
  return null;
}
