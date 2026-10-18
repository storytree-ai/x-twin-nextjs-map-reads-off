// App Router metadata: `metadata` / `generateMetadata` and `viewport` /
// `generateViewport` from each layout and the page, merged root first (a
// segment's keys replace its parent's; title templates apply to the
// segments below), then turned into the <head> tags Next.js renders, in
// its order. Tags are plain { tag, props } descriptors; the RSC entry makes
// them elements (React hoists them into <head>).

function thenable(value) {
  return Object.assign(Promise.resolve(value), value);
}

function pick(params, names) {
  if (!names) return params;
  const out = {};
  for (const n of names) if (params[n] !== undefined) out[n] = params[n];
  return out;
}

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

async function moduleExport(mod, fnName, valueName, params, searchParams, parent) {
  if (!mod) return null;
  if (typeof mod[fnName] === "function") {
    return mod[fnName]({ params: thenable(params), searchParams: thenable(searchParams) }, parent);
  }
  return mod[valueName] || null;
}

function entries(layoutMods, paramNames, params, pageMod) {
  const out = layoutMods.map((m, i) => [m, pick(params, paramNames[i])]);
  if (pageMod) out.push([pageMod, params]);
  return out;
}

/** A title value with the parent's template applied: { absolute, template }. */
function resolveTitle(title, parentTemplate) {
  if (typeof title === "string") {
    return { absolute: parentTemplate ? parentTemplate.replace("%s", title) : title, template: null };
  }
  if (title && typeof title === "object") {
    const absolute =
      title.absolute ?? (title.default !== undefined ? (parentTemplate ? parentTemplate.replace("%s", title.default) : title.default) : null);
    return { absolute, template: title.template || null };
  }
  return { absolute: null, template: null };
}

/** The merged metadata of layouts (root first) and the page module. */
export async function resolveMetadata(layoutMods, paramNames, params, searchParams, pageMod) {
  let resolved = { title: null, description: null };
  let template = null;
  for (const [mod, p] of entries(layoutMods, paramNames, params, pageMod)) {
    const md = await moduleExport(mod, "generateMetadata", "metadata", p, searchParams, Promise.resolve(resolved));
    if (!md) continue;
    const next = { ...resolved, ...md };
    let nextTemplate = template;
    if ("title" in md) {
      const t = resolveTitle(md.title, template);
      next.title = t.absolute;
      if (t.template) nextTemplate = t.template;
    }
    if (md.openGraph && md.openGraph.title !== undefined) {
      next.openGraph = { ...md.openGraph, title: resolveTitle(md.openGraph.title, null).absolute };
    }
    if (md.twitter && md.twitter.title !== undefined) {
      next.twitter = { ...md.twitter, title: resolveTitle(md.twitter.title, null).absolute };
    }
    template = nextTemplate;
    resolved = next;
  }
  return resolved;
}

const DEFAULT_VIEWPORT = { width: "device-width", initialScale: 1 };

/** The merged viewport of layouts (root first) and the page module. */
export async function resolveViewport(layoutMods, paramNames, params, searchParams, pageMod) {
  let resolved = { ...DEFAULT_VIEWPORT };
  for (const [mod, p] of entries(layoutMods, paramNames, params, pageMod)) {
    const vp = await moduleExport(mod, "generateViewport", "viewport", p, searchParams, Promise.resolve(resolved));
    if (vp) resolved = { ...resolved, ...vp };
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Tags

const meta = (props) => ({ tag: "meta", props });
const link = (props) => ({ tag: "link", props });
const named = (name, content) => (content == null || content === "" ? null : meta({ name, content: String(content) }));
const property = (prop, content) => (content == null || content === "" ? null : meta({ property: prop, content: String(content) }));

function resolveUrl(url, base) {
  if (url == null) return null;
  const s = url instanceof URL ? url.href : String(url);
  if (!base) return s;
  try {
    return new URL(s, base).href;
  } catch {
    return s;
  }
}

const VIEWPORT_KEYS = [
  ["width", "width"],
  ["height", "height"],
  ["initialScale", "initial-scale"],
  ["minimumScale", "minimum-scale"],
  ["maximumScale", "maximum-scale"],
  ["viewportFit", "viewport-fit"],
  ["userScalable", "user-scalable"],
  ["interactiveWidget", "interactive-widget"],
];

function viewportContent(vp) {
  const parts = [];
  for (const [key, name] of VIEWPORT_KEYS) {
    let v = vp[key];
    if (v === undefined || v === null) continue;
    if (typeof v === "boolean") v = v ? "yes" : "no";
    parts.push(`${name}=${v}`);
  }
  return parts.join(", ");
}

function viewportTags(vp) {
  const out = [named("viewport", viewportContent(vp))];
  for (const tc of toArray(vp.themeColor)) {
    if (typeof tc === "string") out.push(named("theme-color", tc));
    else if (tc && tc.color) out.push(meta({ name: "theme-color", content: tc.color, ...(tc.media ? { media: tc.media } : {}) }));
  }
  if (vp.colorScheme) out.push(named("color-scheme", vp.colorScheme));
  return out;
}

const ROBOTS_KEYS = [
  "noarchive",
  "nosnippet",
  "noimageindex",
  "nocache",
  "notranslate",
  "indexifembedded",
  "nositelinkssearchbox",
  "unavailable_after",
  "max-video-preview",
  "max-image-preview",
  "max-snippet",
];

/** A robots meta content string, as Next.js writes it. */
export function robotsContent(robots) {
  if (!robots) return null;
  if (typeof robots === "string") return robots;
  const values = [];
  if (robots.index) values.push("index");
  else if (typeof robots.index === "boolean") values.push("noindex");
  if (robots.follow) values.push("follow");
  else if (typeof robots.follow === "boolean") values.push("nofollow");
  for (const key of ROBOTS_KEYS) {
    const v = robots[key];
    if (v !== undefined && v !== false) values.push(typeof v === "boolean" ? key : `${key}:${v}`);
  }
  return values.join(", ") || null;
}

const FORMAT_DETECTION_KEYS = ["telephone", "date", "address", "email", "url"];

function imageList(images, base) {
  return toArray(images).map((img) =>
    typeof img === "string" || img instanceof URL ? { url: resolveUrl(img, base) } : { ...img, url: resolveUrl(img.url, base) },
  );
}

/** og:image / twitter:image style groups: the url, then its properties. */
function mediaTags(prefix, items, attr) {
  const out = [];
  const tag = attr === "name" ? named : property;
  for (const item of items) {
    out.push(tag(prefix, item.url));
    if (item.secureUrl) out.push(tag(`${prefix}:secure_url`, resolveUrl(item.secureUrl)));
    if (item.type) out.push(tag(`${prefix}:type`, item.type));
    if (item.width != null) out.push(tag(`${prefix}:width`, item.width));
    if (item.height != null) out.push(tag(`${prefix}:height`, item.height));
    if (item.alt) out.push(tag(`${prefix}:alt`, item.alt));
  }
  return out;
}

function openGraphTags(og, base) {
  const out = [
    property("og:determiner", og.determiner),
    property("og:title", og.title),
    property("og:description", og.description),
    property("og:url", resolveUrl(og.url, base)),
    property("og:site_name", og.siteName),
    property("og:locale", og.locale),
    property("og:country_name", og.countryName),
    property("og:ttl", og.ttl),
    ...mediaTags("og:image", imageList(og.images, base), "property"),
    ...mediaTags("og:video", imageList(og.videos, base), "property"),
    ...mediaTags("og:audio", imageList(og.audio, base), "property"),
    ...toArray(og.emails).map((v) => property("og:email", v)),
    ...toArray(og.phoneNumbers).map((v) => property("og:phone_number", v)),
    ...toArray(og.faxNumbers).map((v) => property("og:fax_number", v)),
    ...toArray(og.alternateLocale).map((v) => property("og:locale:alternate", v)),
  ];
  if (og.type) {
    out.push(property("og:type", og.type));
    const typed = {
      article: [
        ["article:published_time", og.publishedTime],
        ["article:modified_time", og.modifiedTime],
        ["article:expiration_time", og.expirationTime],
        ...toArray(og.authors).map((v) => ["article:author", v]),
        ["article:section", og.section],
        ...toArray(og.tags).map((v) => ["article:tag", v]),
      ],
      book: [
        ["book:isbn", og.isbn],
        ["book:release_date", og.releaseDate],
        ...toArray(og.authors).map((v) => ["book:author", v]),
        ...toArray(og.tags).map((v) => ["book:tag", v]),
      ],
      profile: [
        ["profile:first_name", og.firstName],
        ["profile:last_name", og.lastName],
        ["profile:username", og.username],
        ["profile:gender", og.gender],
      ],
    }[og.type];
    for (const [k, v] of typed || []) out.push(property(k, v));
  }
  return out;
}

function twitterTags(tw, base) {
  const images = imageList(tw.images, base);
  const card = tw.card || (images.length ? "summary_large_image" : "summary");
  const out = [
    named("twitter:card", card),
    named("twitter:site", tw.site),
    named("twitter:site:id", tw.siteId),
    named("twitter:creator", tw.creator),
    named("twitter:creator:id", tw.creatorId),
    named("twitter:title", tw.title),
    named("twitter:description", tw.description),
    ...mediaTags("twitter:image", images, "name"),
  ];
  if (card === "player") {
    for (const p of toArray(tw.players)) {
      out.push(
        named("twitter:player", resolveUrl(p.playerUrl, base)),
        named("twitter:player:stream", resolveUrl(p.streamUrl, base)),
        named("twitter:player:width", p.width),
        named("twitter:player:height", p.height),
      );
    }
  }
  if (card === "app" && tw.app) {
    for (const type of ["iphone", "ipad", "googleplay"]) {
      out.push(
        named(`twitter:app:name:${type}`, tw.app.name),
        named(`twitter:app:id:${type}`, tw.app.id && tw.app.id[type]),
        named(`twitter:app:url:${type}`, tw.app.url && resolveUrl(tw.app.url[type], base)),
      );
    }
  }
  return out;
}

/** Next.js fills twitter's title, description and images from openGraph. */
function withTwitterFallback(md) {
  const og = md.openGraph;
  if (!og) return md.twitter;
  const tw = { ...(md.twitter || {}) };
  if (!tw.title && og.title) tw.title = og.title;
  if (!tw.description && (og.description || md.description)) tw.description = og.description || md.description;
  if (!("images" in tw) || !tw.images) {
    if (og.images) tw.images = og.images;
  }
  return Object.keys(tw).length ? tw : md.twitter;
}

const ICON_RELS = { icon: "icon", shortcut: "shortcut icon", apple: "apple-touch-icon" };

function iconTags(icons, base) {
  if (!icons) return [];
  const out = [];
  const add = (rel, icon) => {
    if (typeof icon === "string" || icon instanceof URL) return out.push(link({ rel, href: resolveUrl(icon, base) }));
    const { url, rel: ownRel, ...rest } = icon;
    out.push(link({ rel: ownRel || rel, href: resolveUrl(url, base), ...rest }));
  };
  if (typeof icons === "string" || icons instanceof URL || Array.isArray(icons)) {
    for (const i of toArray(icons)) add("icon", i);
    return out;
  }
  for (const key of ["shortcut", "icon", "apple"]) for (const i of toArray(icons[key])) add(ICON_RELS[key], i);
  for (const i of toArray(icons.other)) add(i.rel || "icon", i);
  return out;
}

function appLinksTags(appLinks) {
  const out = [];
  for (const [platform, value] of Object.entries(appLinks)) {
    for (const item of toArray(value)) {
      for (const [k, v] of Object.entries(item)) out.push(property(`al:${platform}:${k}`, v));
    }
  }
  return out;
}

/**
 * The <head> tags for resolved metadata and viewport, in Next.js's order.
 * fileIcons are the icons app/'s icon files contribute.
 */
export function metadataTags(md, vp = DEFAULT_VIEWPORT, fileIcons = []) {
  const base = md.metadataBase ? resolveUrl(md.metadataBase) : null;
  const out = [meta({ charSet: "utf-8" }), ...viewportTags(vp)];
  if (md.title != null) out.push({ tag: "title", props: {}, children: String(md.title) });
  out.push(named("description", md.description));
  out.push(named("application-name", md.applicationName));
  for (const a of toArray(md.authors)) {
    if (a.url) out.push(link({ rel: "author", href: resolveUrl(a.url, base) }));
    if (a.name) out.push(named("author", a.name));
  }
  if (md.manifest) out.push(link({ rel: "manifest", href: resolveUrl(md.manifest, base) }));
  out.push(named("generator", md.generator));
  out.push(named("keywords", toArray(md.keywords).join(",")));
  out.push(named("referrer", md.referrer));
  out.push(named("creator", md.creator));
  out.push(named("publisher", md.publisher));
  out.push(named("robots", robotsContent(md.robots)));
  if (md.robots && typeof md.robots === "object") out.push(named("googlebot", robotsContent(md.robots.googleBot)));
  out.push(named("abstract", md.abstract));
  for (const a of toArray(md.archives)) out.push(link({ rel: "archives", href: resolveUrl(a, base) }));
  for (const a of toArray(md.assets)) out.push(link({ rel: "assets", href: resolveUrl(a, base) }));
  for (const a of toArray(md.bookmarks)) out.push(link({ rel: "bookmarks", href: resolveUrl(a, base) }));
  if (md.pagination) {
    if (md.pagination.previous) out.push(link({ rel: "prev", href: resolveUrl(md.pagination.previous, base) }));
    if (md.pagination.next) out.push(link({ rel: "next", href: resolveUrl(md.pagination.next, base) }));
  }
  out.push(named("category", md.category));
  out.push(named("classification", md.classification));
  for (const [k, v] of Object.entries(md.other || {})) for (const c of toArray(v)) out.push(named(k, c));

  const alt = md.alternates;
  if (alt) {
    if (alt.canonical) {
      const c = typeof alt.canonical === "object" && !(alt.canonical instanceof URL) ? alt.canonical.url : alt.canonical;
      out.push(link({ rel: "canonical", href: resolveUrl(c, base) }));
    }
    for (const [lang, v] of Object.entries(alt.languages || {})) {
      for (const item of toArray(v)) {
        const href = typeof item === "object" && !(item instanceof URL) ? item.url : item;
        out.push(link({ rel: "alternate", hrefLang: lang, href: resolveUrl(href, base) }));
      }
    }
    for (const [media, v] of Object.entries(alt.media || {})) out.push(link({ rel: "alternate", media, href: resolveUrl(v, base) }));
    for (const [type, v] of Object.entries(alt.types || {})) out.push(link({ rel: "alternate", type, href: resolveUrl(v, base) }));
  }

  if (md.itunes) {
    const content = `app-id=${md.itunes.appId}` + (md.itunes.appArgument ? `, app-argument=${md.itunes.appArgument}` : "");
    out.push(named("apple-itunes-app", content));
  }
  if (md.facebook) {
    if (md.facebook.appId) out.push(property("fb:app_id", md.facebook.appId));
    for (const a of toArray(md.facebook.admins)) out.push(property("fb:admins", a));
  }
  if (md.pinterest && md.pinterest.richPin !== undefined) out.push(named("pinterest-rich-pin", String(md.pinterest.richPin)));
  if (md.verification) {
    const v = md.verification;
    for (const c of toArray(v.google)) out.push(named("google-site-verification", c));
    for (const c of toArray(v.yahoo)) out.push(named("y_key", c));
    for (const c of toArray(v.yandex)) out.push(named("yandex-verification", c));
    for (const c of toArray(v.me)) out.push(named("me", c));
    for (const [k, val] of Object.entries(v.other || {})) for (const c of toArray(val)) out.push(named(k, c));
  }
  if (md.appleWebApp) {
    const awa = md.appleWebApp === true ? { capable: true } : md.appleWebApp;
    if (awa.capable) out.push(named("mobile-web-app-capable", "yes"));
    out.push(named("apple-mobile-web-app-title", awa.title));
    for (const img of toArray(awa.startupImage)) {
      const s = typeof img === "string" ? { url: img } : img;
      out.push(link({ rel: "apple-touch-startup-image", href: resolveUrl(s.url, base), ...(s.media ? { media: s.media } : {}) }));
    }
    out.push(named("apple-mobile-web-app-status-bar-style", awa.statusBarStyle));
  }
  if (md.formatDetection) {
    const off = FORMAT_DETECTION_KEYS.filter((k) => md.formatDetection[k] === false).map((k) => `${k}=no`);
    out.push(named("format-detection", off.join(", ")));
  }
  if (md.openGraph) out.push(...openGraphTags(md.openGraph, base));
  const twitter = withTwitterFallback(md);
  if (twitter) out.push(...twitterTags(twitter, base));
  if (md.appLinks) out.push(...appLinksTags(md.appLinks));
  out.push(...iconTags(md.icons, base), ...fileIcons.map((props) => link(props)));
  return out.filter(Boolean);
}
