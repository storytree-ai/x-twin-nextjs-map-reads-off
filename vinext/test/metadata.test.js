import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMetadata, resolveViewport, metadataTags, robotsContent } from "../src/app/metadata.js";

/** The tags as "tag attr=value ..." strings, for readable assertions. */
const show = (tags) =>
  tags.map((t) => [t.tag, ...Object.entries(t.props).map(([k, v]) => `${k}=${v}`), ...(t.children ? [`>${t.children}`] : [])].join(" "));

test("title templates from layouts apply to the segments below", async () => {
  const layout = { metadata: { title: { template: "%s | Layout", default: "Default" } } };
  const md = await resolveMetadata([layout], [[]], {}, {}, { metadata: { title: "Page" } });
  assert.equal(md.title, "Page | Layout");
  const own = await resolveMetadata([layout], [[]], {}, {}, null);
  assert.equal(own.title, "Default");
});

test("generateMetadata receives params and the parent's resolved metadata", async () => {
  const layout = { generateMetadata: async () => ({ openGraph: { images: ["/base.jpg"] } }) };
  const page = {
    async generateMetadata({ params }, parent) {
      const { slug } = await params;
      const prev = (await parent).openGraph.images;
      return { title: `params - ${slug}`, openGraph: { images: ["/new.jpg", ...prev] } };
    },
  };
  const md = await resolveMetadata([layout], [[]], { slug: "s" }, {}, page);
  assert.equal(md.title, "params - s");
  assert.deepEqual(md.openGraph.images, ["/new.jpg", "/base.jpg"]);
});

test("basic fields, robots and format detection render as Next.js writes them", () => {
  const tags = show(
    metadataTags({
      title: "T",
      description: "D",
      keywords: ["a", "b"],
      authors: [{ name: "x" }, { name: "y", url: "https://y.com" }],
      robots: { index: false, follow: true, nocache: true, googleBot: { index: true, follow: false, noimageindex: true } },
      formatDetection: { email: false, address: false, telephone: false },
    }),
  );
  assert.deepEqual(tags, [
    "meta charSet=utf-8",
    "meta name=viewport content=width=device-width, initial-scale=1",
    "title >T",
    "meta name=description content=D",
    "meta name=author content=x",
    "link rel=author href=https://y.com",
    "meta name=author content=y",
    "meta name=keywords content=a,b",
    "meta name=robots content=noindex, follow, nocache",
    "meta name=googlebot content=index, nofollow, noimageindex",
    "meta name=format-detection content=telephone=no, address=no, email=no",
  ]);
});

test("openGraph, twitter (filled from openGraph) and alternates", () => {
  const tags = show(
    metadataTags({
      openGraph: { title: "OG", description: "OGD", type: "website", images: { url: "https://e.com/i.png", width: 1200, alt: "A" } },
      alternates: { canonical: "https://e.com/c", languages: { "en-US": "https://e.com/en" } },
    }),
  ).slice(2);
  assert.deepEqual(tags, [
    "link rel=canonical href=https://e.com/c",
    "link rel=alternate hrefLang=en-US href=https://e.com/en",
    "meta property=og:title content=OG",
    "meta property=og:description content=OGD",
    "meta property=og:image content=https://e.com/i.png",
    "meta property=og:image:width content=1200",
    "meta property=og:image:alt content=A",
    "meta property=og:type content=website",
    "meta name=twitter:card content=summary_large_image",
    "meta name=twitter:title content=OG",
    "meta name=twitter:description content=OGD",
    "meta name=twitter:image content=https://e.com/i.png",
    "meta name=twitter:image:width content=1200",
    "meta name=twitter:image:alt content=A",
  ]);
});

test("twitter player and app cards, itunes and app links", () => {
  const tags = show(
    metadataTags({
      itunes: { appId: "1", appArgument: "app://x" },
      twitter: { card: "player", players: { playerUrl: "https://e.com/p", streamUrl: "https://e.com/s", width: 480, height: 360 } },
      appLinks: { ios: { url: "https://e.com/ios", app_store_id: "1" }, web: { should_fallback: true } },
    }),
  ).slice(2);
  assert.deepEqual(tags, [
    "meta name=apple-itunes-app content=app-id=1, app-argument=app://x",
    "meta name=twitter:card content=player",
    "meta name=twitter:player content=https://e.com/p",
    "meta name=twitter:player:stream content=https://e.com/s",
    "meta name=twitter:player:width content=480",
    "meta name=twitter:player:height content=360",
    "meta property=al:ios:url content=https://e.com/ios",
    "meta property=al:ios:app_store_id content=1",
    "meta property=al:web:should_fallback content=true",
  ]);
});

test("viewport exports merge over the default and render theme-color and color-scheme", async () => {
  const vp = await resolveViewport([], [], {}, {}, { viewport: { themeColor: "#0070f3", colorScheme: "light dark", maximumScale: 1 } });
  assert.deepEqual(show(metadataTags({}, vp)).slice(1), [
    "meta name=viewport content=width=device-width, initial-scale=1, maximum-scale=1",
    "meta name=theme-color content=#0070f3",
    "meta name=color-scheme content=light dark",
  ]);
});

test("robots strings pass through", () => {
  assert.equal(robotsContent("index, follow"), "index, follow");
});
