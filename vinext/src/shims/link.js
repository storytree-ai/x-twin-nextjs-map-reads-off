// next/link: an anchor for href (string or { pathname, query }) whose
// clicks become client-side transitions through next/router.
import { createElement, forwardRef, Children, isValidElement, cloneElement } from "react";
import Router, { resolveHref } from "./router.js";

function isModifiedEvent(event) {
  const target = event.currentTarget && event.currentTarget.getAttribute("target");
  return (
    (target && target !== "_self") ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    (event.nativeEvent && event.nativeEvent.which === 2) ||
    (event.button !== undefined && event.button !== 0)
  );
}

function isExternal(href) {
  if (typeof window === "undefined") return false;
  try {
    return new URL(href, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

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
    onClick,
    children,
    ...rest
  } = props;
  const shown = resolveHref(as !== undefined ? as : href);

  const handleClick = (e) => {
    if (onClick) onClick(e);
    if (e.defaultPrevented || isModifiedEvent(e) || isExternal(shown)) return;
    if (e.currentTarget && e.currentTarget.hasAttribute && e.currentTarget.hasAttribute("download")) return;
    e.preventDefault();
    if (onNavigate) {
      let prevented = false;
      onNavigate({
        url: new URL(shown, window.location.href),
        preventDefault: () => {
          prevented = true;
        },
      });
      if (prevented) return;
    }
    const navigate = replace ? Router.replace : Router.push;
    navigate(href, as, { shallow, scroll, locale });
  };

  if (legacyBehavior) {
    const child = Children.only(children);
    if (isValidElement(child)) {
      return cloneElement(child, {
        href: shown,
        ref,
        onClick: (e) => {
          if (child.props.onClick) child.props.onClick(e);
          handleClick(e);
        },
      });
    }
  }
  return createElement("a", { ...rest, ref, href: shown, onClick: handleClick }, children);
});

export default Link;
