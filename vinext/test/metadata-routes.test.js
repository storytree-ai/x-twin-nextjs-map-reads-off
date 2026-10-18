import { test } from "node:test";
import assert from "node:assert/strict";
import { robotsTxt, sitemapXml } from "../src/app/metadata-routes.js";

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
