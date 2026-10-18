// next/document: Html, Head, Main and NextScript for a custom pages/_document.
// The server renders the document after the page and splices the page HTML,
// collected head tags and scripts in at the markers these components leave
// (see server/document-html.js).
import { createElement, Component } from "react";


// Markers are custom elements replaced as strings after rendering.
const marker = (m, key) => createElement("vinext-marker", { key, "data-marker": m });

export function Html({ children, ...props }) {
  return createElement("html", props, children);
}

export function Head({ children, ...props }) {
  return createElement(
    "head",
    props,
    createElement("meta", { charSet: "utf-8" }),
    children,
    marker("head"),
  );
}

export function Main() {
  return marker("main");
}

export function NextScript() {
  return marker("scripts");
}

/** The base class a custom _document may extend. */
export default class Document extends Component {
  static async getInitialProps(ctx) {
    return ctx && typeof ctx.defaultGetInitialProps === "function" ? ctx.defaultGetInitialProps(ctx) : {};
  }
  render() {
    return createElement(
      Html,
      null,
      createElement(Head, null),
      createElement("body", null, createElement(Main), createElement(NextScript)),
    );
  }
}
