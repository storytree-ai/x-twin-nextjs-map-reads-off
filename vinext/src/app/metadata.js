// App Router metadata: `metadata` / `generateMetadata` from each layout and
// the page, merged root first, rendered as <title> and <meta> elements
// (React hoists them into <head>). Covers title (with templates) and
// description; the rest of the Metadata API lands with its own increment.
import { createElement as h } from "react";

function thenable(value) {
  return Object.assign(Promise.resolve(value), value);
}

function pick(params, names) {
  if (!names) return params;
  const out = {};
  for (const n of names) if (params[n] !== undefined) out[n] = params[n];
  return out;
}

async function moduleMetadata(mod, params, searchParams, parent) {
  if (!mod) return null;
  if (typeof mod.generateMetadata === "function") {
    return mod.generateMetadata({ params: thenable(params), searchParams: thenable(searchParams) }, parent);
  }
  return mod.metadata || null;
}

/** The merged metadata of layouts (root first) and the page module. */
export async function resolveMetadata(layoutMods, paramNames, params, searchParams, pageMod) {
  const entries = layoutMods.map((m, i) => [m, pick(params, paramNames[i])]);
  if (pageMod) entries.push([pageMod, params]);
  let resolved = { title: null, description: null };
  let template = null;
  for (const [mod, p] of entries) {
    const md = await moduleMetadata(mod, p, searchParams, Promise.resolve(resolved));
    if (!md) continue;
    const next = { ...resolved, ...md };
    if ("title" in md) {
      const t = md.title;
      if (typeof t === "string") next.title = template ? template.replace("%s", t) : t;
      else if (t && typeof t === "object") {
        next.title = t.absolute ?? (t.default !== undefined ? t.default : resolved.title);
        if (t.template) template = t.template;
      } else next.title = null;
    }
    resolved = next;
  }
  return resolved;
}

/** <title> / <meta> elements for resolved metadata. */
export function renderMetadata(md) {
  const out = [h("meta", { key: "charset", charSet: "utf-8" })];
  if (md.title != null) out.push(h("title", { key: "title" }, String(md.title)));
  if (md.description != null) out.push(h("meta", { key: "description", name: "description", content: md.description }));
  out.push(h("meta", { key: "viewport", name: "viewport", content: "width=device-width, initial-scale=1" }));
  return out;
}
