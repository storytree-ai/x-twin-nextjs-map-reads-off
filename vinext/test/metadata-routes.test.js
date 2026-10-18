import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { robotsTxt, sitemapXml, metadataRouteResponse, dynamicIconLink } from "../src/app/metadata-routes.js";
import { scanMetadataFiles } from "../src/routing/app-routes.js";
import { resolveShim } from "../src/shims/index.js";

test("robots.ts data becomes robots.txt", () => {
  const txt = robotsTxt({ rules: { userAgent: "*", allow: "/", disallow: "/private/" }, sitemap: "https://e.com/sitemap.xml" });
  assert.equal(txt, "User-Agent: *\nAllow: /\nDisallow: /private/\n\nSitemap: https://e.com/sitemap.xml\n");
});

test("sitemap.ts data becomes an XML urlset", () => {
  const xml = sitemapXml([
    { url: "https://e.com", lastModified: new Date("2025-01-01"), changeFrequency: "yearly", priority: 1, alternates: { languages: { fr: "https://e.com/fr" } } },
  ]);
  assert.equal(
    xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
      '<url>\n<loc>https://e.com</loc>\n<xhtml:link rel="alternate" hreflang="fr" href="https://e.com/fr" />\n' +
      "<lastmod>2025-01-01T00:00:00.000Z</lastmod>\n<changefreq>yearly</changefreq>\n<priority>1</priority>\n</url>\n</urlset>\n",
  );
});

test("app/icon.tsx and apple-icon.tsx are routes at /icon and /apple-icon, linked as /icon?<hash>", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-icons-"));
  for (const f of ["favicon.ico", "icon.png", "icon.tsx", "apple-icon.ts", "robots.ts"]) fs.writeFileSync(path.join(dir, f), f);
  const { icons, routes } = scanMetadataFiles(dir);
  assert.deepEqual(
    icons.map((i) => [i.rel, i.href.replace(/\?[0-9a-f]{16}$/, "?<hash>"), i.dynamic || false]),
    [
      ["icon", "/favicon.ico", false],
      ["icon", "/icon.png", false],
      ["icon", "/icon?<hash>", true],
      ["apple-touch-icon", "/apple-icon?<hash>", true],
    ],
  );
  assert.deepEqual(
    routes.map((r) => [r.path, r.type, path.basename(r.file)]),
    [
      ["/robots.txt", "robots", "robots.ts"],
      ["/icon", "image", "icon.tsx"],
      ["/apple-icon", "image", "apple-icon.ts"],
    ],
  );
});

test("a dynamic icon's link takes its module's contentType and size", () => {
  const icon = { rel: "icon", href: "/icon?abc", dynamic: true };
  assert.deepEqual(dynamicIconLink(icon, { default() {} }), { rel: "icon", href: "/icon?abc", type: "image/png" });
  assert.deepEqual(dynamicIconLink(icon, { contentType: "image/svg+xml", size: { width: 32, height: 16 } }), {
    rel: "icon",
    href: "/icon?abc",
    type: "image/svg+xml",
    sizes: "32x16",
  });
});

test("a dynamic image route answers its default export's Response", async () => {
  const res = await metadataRouteResponse("image", { default: () => new Response("png", { headers: { "content-type": "image/png" } }) });
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(await res.text(), "png");
});

test("next/og resolves to vinext's ImageResponse shim", () => {
  assert.match(resolveShim("next/og"), /shims[\\/]og\.js$/);
});
