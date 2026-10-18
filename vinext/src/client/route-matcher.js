// The browser's route matcher: page patterns in the server's order (most
// specific first) matched against a pathname, with the params it fills.

function decode(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function createPatternMatcher(patterns) {
  const compiled = patterns.map((pattern) => {
    const segments = pattern.split("/").filter(Boolean).map((part) => {
      let m = /^\[\[\.\.\.(.+)\]\]$/.exec(part);
      if (m) return { type: "optional-catch-all", name: m[1] };
      m = /^\[\.\.\.(.+)\]$/.exec(part);
      if (m) return { type: "catch-all", name: m[1] };
      m = /^\[(.+)\]$/.exec(part);
      if (m) return { type: "dynamic", name: m[1] };
      return { type: "static", value: part };
    });
    return { pattern, segments };
  });

  const matchOne = (segments, parts) => {
    const params = {};
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.type === "catch-all" || seg.type === "optional-catch-all") {
        const rest = parts.slice(i);
        if (!rest.length && seg.type === "catch-all") return null;
        if (rest.length) params[seg.name] = rest;
        return params;
      }
      if (parts[i] === undefined) return null;
      if (seg.type === "static") {
        if (seg.value !== parts[i]) return null;
      } else {
        params[seg.name] = parts[i];
      }
    }
    return parts.length === segments.length ? params : null;
  };

  /** { pattern, params } for pathname, or null. */
  return (pathname) => {
    const parts = pathname.split("/").filter(Boolean).map(decode);
    for (const { pattern, segments } of compiled) {
      const params = matchOne(segments, parts);
      if (params) return { pattern, params };
    }
    return null;
  };
}
