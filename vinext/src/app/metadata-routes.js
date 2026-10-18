// app/robots.ts, sitemap.ts and manifest.ts: their default export's data
// serialized as Next.js serializes it; app/icon.tsx and apple-icon.tsx: the
// image their default export answers.

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function robotsTxt(data) {
  let out = "";
  for (const rule of toArray(data.rules)) {
    for (const agent of toArray(rule.userAgent || ["*"])) out += `User-Agent: ${agent}\n`;
    for (const item of toArray(rule.allow)) out += `Allow: ${item}\n`;
    for (const item of toArray(rule.disallow)) out += `Disallow: ${item}\n`;
    if (rule.crawlDelay) out += `Crawl-delay: ${rule.crawlDelay}\n`;
    out += "\n";
  }
  if (data.host) out += `Host: ${data.host}\n`;
  for (const item of toArray(data.sitemap)) out += `Sitemap: ${item}\n`;
  return out;
}

function videoXml(video) {
  const fields = [
    "<video:video>",
    `<video:title>${video.title}</video:title>`,
    `<video:thumbnail_loc>${video.thumbnail_loc}</video:thumbnail_loc>`,
    `<video:description>${video.description}</video:description>`,
  ];
  for (const key of [
    "content_loc",
    "player_loc",
    "duration",
    "view_count",
    "tag",
    "rating",
    "expiration_date",
    "publication_date",
    "family_friendly",
    "requires_subscription",
    "live",
  ]) {
    if (video[key] !== undefined) fields.push(`<video:${key}>${video[key]}</video:${key}>`);
  }
  if (video.restriction) {
    fields.push(`<video:restriction relationship="${video.restriction.relationship}">${video.restriction.content}</video:restriction>`);
  }
  if (video.platform) {
    fields.push(`<video:platform relationship="${video.platform.relationship}">${video.platform.content}</video:platform>`);
  }
  if (video.uploader) {
    const info = video.uploader.info ? ` info="${video.uploader.info}"` : "";
    fields.push(`<video:uploader${info}>${video.uploader.content}</video:uploader>`);
  }
  fields.push("</video:video>\n");
  return fields.join("\n");
}

export function sitemapXml(data) {
  const hasAlternates = data.some((item) => Object.keys((item.alternates && item.alternates.languages) || {}).length > 0);
  const hasImages = data.some((item) => item.images && item.images.length);
  const hasVideos = data.some((item) => item.videos && item.videos.length);
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  if (hasImages) out += ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"';
  if (hasVideos) out += ' xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"';
  out += hasAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' : ">\n";
  for (const item of data) {
    out += `<url>\n<loc>${item.url}</loc>\n`;
    const languages = (item.alternates && item.alternates.languages) || {};
    for (const lang of Object.keys(languages)) {
      out += `<xhtml:link rel="alternate" hreflang="${lang}" href="${languages[lang]}" />\n`;
    }
    for (const image of item.images || []) out += `<image:image>\n<image:loc>${image}</image:loc>\n</image:image>\n`;
    for (const video of item.videos || []) out += videoXml(video);
    if (item.lastModified) {
      const date = item.lastModified instanceof Date ? item.lastModified.toISOString() : item.lastModified;
      out += `<lastmod>${date}</lastmod>\n`;
    }
    if (item.changeFrequency) out += `<changefreq>${item.changeFrequency}</changefreq>\n`;
    if (typeof item.priority === "number") out += `<priority>${item.priority}</priority>\n`;
    out += "</url>\n";
  }
  return out + "</urlset>\n";
}

const SERIALIZERS = {
  robots: [robotsTxt, "text/plain"],
  sitemap: [sitemapXml, "application/xml"],
  manifest: [(data) => JSON.stringify(data), "application/manifest+json"],
};

/** The <link> props of a generated icon: its contentType and size exports. */
export function dynamicIconLink({ rel, href }, mod) {
  const props = { rel, href, type: mod.contentType || "image/png" };
  if (mod.size) props.sizes = `${mod.size.width}x${mod.size.height}`;
  return props;
}

/** The Response for a metadata route module. */
export async function metadataRouteResponse(type, mod) {
  // A generated image (app/icon.tsx): the default export answers it.
  if (type === "image") return await mod.default({ params: Promise.resolve({}) });
  const [serialize, contentType] = SERIALIZERS[type];
  const data = typeof mod.default === "function" ? await mod.default() : mod.default;
  return new Response(serialize(data), {
    headers: { "content-type": contentType, "cache-control": "public, max-age=0, must-revalidate" },
  });
}
