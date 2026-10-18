"use client";
// Client boundaries the App Router's server tree places around segments:
// error.tsx / global-error.tsx (ErrorBoundary) and not-found.tsx
// (NotFoundBoundary). A boundary resets when the URL changes.
import { Component, createElement, useContext } from "react";
import { AppNavContext } from "../shims/app-nav-context.js";
import { httpFallbackStatus, parseRedirectError } from "../shims/navigation-shared.js";

function usePathnameKey() {
  const nav = useContext(AppNavContext);
  return nav ? nav.pathname : "";
}

class ErrorBoundaryInner extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, pathname: props.pathname };
    this.reset = () => this.setState({ error: null });
  }
  static getDerivedStateFromError(error) {
    // notFound()/redirect() belong to the boundaries above.
    if (httpFallbackStatus(error) || parseRedirectError(error)) throw error;
    return { error };
  }
  static getDerivedStateFromProps(props, state) {
    if (props.pathname !== state.pathname) return { error: null, pathname: props.pathname };
    return null;
  }
  render() {
    if (this.state.error) {
      return createElement(this.props.errorComponent, { error: this.state.error, reset: this.reset });
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ errorComponent, children }) {
  const pathname = usePathnameKey();
  return createElement(ErrorBoundaryInner, { errorComponent, pathname }, children);
}

class NotFoundBoundaryInner extends Component {
  constructor(props) {
    super(props);
    this.state = { notFound: false, pathname: props.pathname };
  }
  static getDerivedStateFromError(error) {
    if (httpFallbackStatus(error) === 404) return { notFound: true };
    throw error;
  }
  static getDerivedStateFromProps(props, state) {
    if (props.pathname !== state.pathname) return { notFound: false, pathname: props.pathname };
    return null;
  }
  render() {
    return this.state.notFound ? this.props.fallback : this.props.children;
  }
}

export function NotFoundBoundary({ fallback, children }) {
  const pathname = usePathnameKey();
  return createElement(NotFoundBoundaryInner, { fallback, pathname }, children);
}
