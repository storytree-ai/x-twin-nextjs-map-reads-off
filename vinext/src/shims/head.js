// next/head. On the server, <Head> children are collected during render and
// serialised into the document head; in the browser they are applied to
// document.head on mount and removed on unmount.
import { Children, isValidElement, useEffect } from "react";

const isServer = typeof window === "undefined";
let ssrHead = [];
let headRenderer = null;

function flatten(children, out = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type && typeof child.type === "symbol") flatten(child.props.children, out);
    else out.push(child);
  });
  return out;
}

function headKey(el) {
  if (el.key != null) return `key:${el.key}`;
  const p = el.props || {};
  if (el.type === "title") return "title";
  if (el.type === "base") return "base";
  if (el.type === "meta") {
    if (p.charSet || p.charset) return "charset";
    if (p.name) return `meta-name:${p.name}`;
    if (p.property) return `meta-property:${p.property}`;
    if (p.httpEquiv) return `meta-http-equiv:${p.httpEquiv}`;
  }
  return null;
}

/** Last one wins for elements sharing a key (title, meta name, key=...). */
export function dedupeHead(elements) {
  const seen = new Set();
  const out = [];
  for (let i = elements.length - 1; i >= 0; i--) {
    const k = headKey(elements[i]);
    if (k) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    out.unshift(elements[i]);
  }
  return out;
}

export function resetSSRHead() {
  ssrHead = [];
}

export function getSSRHeadElements() {
  return dedupeHead(ssrHead);
}

/** The server registers react-dom/server's renderToStaticMarkup here. */
export function _setHeadRenderer(render) {
  headRenderer = render;
}

export function getSSRHeadHTML() {
  if (!headRenderer) return "";
  return getSSRHeadElements()
    .map((el) => headRenderer(el))
    .join("");
}

const ATTR_NAMES = { className: "class", htmlFor: "for", charSet: "charset", httpEquiv: "http-equiv" };

function textOf(children) {
  return Children.toArray(children)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : ""))
    .join("");
}

function toDomNode(el) {
  const node = document.createElement(el.type);
  for (const [k, v] of Object.entries(el.props || {})) {
    if (k === "children" || k === "dangerouslySetInnerHTML" || v == null || v === false) continue;
    node.setAttribute(ATTR_NAMES[k] || k, v === true ? "" : String(v));
  }
  if (el.props?.dangerouslySetInnerHTML) node.innerHTML = el.props.dangerouslySetInnerHTML.__html || "";
  else if (el.props?.children != null) node.textContent = textOf(el.props.children);
  node.setAttribute("data-vinext-head", "");
  return node;
}

function sameAs(existing, el) {
  const p = el.props || {};
  if (el.type === "meta") {
    if (p.name) return existing.querySelector(`meta[name="${CSS.escape(p.name)}"]`);
    if (p.property) return existing.querySelector(`meta[property="${CSS.escape(p.property)}"]`);
    if (p.charSet || p.charset) return existing.querySelector("meta[charset]");
  }
  return null;
}

function ClientHead({ children }) {
  useEffect(() => {
    const added = [];
    const restored = [];
    let prevTitle = null;
    for (const el of dedupeHead(flatten(children))) {
      if (el.type === "title") {
        prevTitle = document.title;
        document.title = textOf(el.props.children);
        continue;
      }
      if (typeof el.type !== "string") continue;
      const old = sameAs(document.head, el);
      if (old) {
        restored.push(old);
        old.remove();
      }
      const node = toDomNode(el);
      document.head.appendChild(node);
      added.push(node);
    }
    return () => {
      for (const n of added) n.remove();
      for (const n of restored) document.head.appendChild(n);
      if (prevTitle !== null) document.title = prevTitle;
    };
  }, [children]);
  return null;
}

function Head({ children }) {
  if (isServer) {
    ssrHead.push(...flatten(children));
    return null;
  }
  return ClientHead({ children });
}

export default Head;
