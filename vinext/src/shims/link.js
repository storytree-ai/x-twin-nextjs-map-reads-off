// next/link: an anchor for href (string or { pathname, query }). Client-side
// transitions arrive with the Pages Router navigation increment.
import { createElement, forwardRef } from "react";
import { _urlToString } from "./router.js";

const Link = forwardRef(function Link(props, ref) {
  const {
    href,
    as,
    replace,
    scroll,
    shallow,
    passHref,
    prefetch,
    locale,
    legacyBehavior,
    onNavigate,
    children,
    ...rest
  } = props;
  const url = _urlToString(as !== undefined ? as : href);
  return createElement("a", { ...rest, ref, href: url }, children);
});

export default Link;
