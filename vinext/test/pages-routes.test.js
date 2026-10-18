import { test } from "node:test";
import assert from "node:assert/strict";
import { fileToRoute, sortRoutes, matchRoute } from "../src/routing/pages-routes.js";

const files = [
  "index.tsx",
  "about.tsx",
  "posts/[id].tsx",
  "posts/missing.tsx",
  "docs/[...slug].tsx",
  "sign-up/[[...sign-up]]/index.tsx",
];

function routes() {
  return sortRoutes(files.map((f) => fileToRoute(f, "/app/pages/" + f)));
}

test("file paths map to Next.js route patterns", () => {
  assert.equal(fileToRoute("index.tsx", "x").pattern, "/");
  assert.equal(fileToRoute("posts/[id].tsx", "x").pattern, "/posts/[id]");
  assert.equal(fileToRoute("blog/index.js", "x").pattern, "/blog");
  assert.equal(fileToRoute("sign-up/[[...sign-up]]/index.tsx", "x").pattern, "/sign-up/[[...sign-up]]");
});

test("static routes win over dynamic ones", () => {
  const m = matchRoute(routes(), "/posts/missing");
  assert.equal(m.route.pattern, "/posts/missing");
  assert.deepEqual(m.params, {});
});

test("dynamic segment captures its param", () => {
  const m = matchRoute(routes(), "/posts/123");
  assert.equal(m.route.pattern, "/posts/[id]");
  assert.deepEqual(m.params, { id: "123" });
});

test("catch-all captures every remaining segment", () => {
  const m = matchRoute(routes(), "/docs/api/v2/users");
  assert.equal(m.route.pattern, "/docs/[...slug]");
  assert.deepEqual(m.params, { slug: ["api", "v2", "users"] });
  assert.equal(matchRoute(routes(), "/docs"), null);
});

test("optional catch-all matches with and without segments", () => {
  assert.deepEqual(matchRoute(routes(), "/sign-up").params, {});
  assert.deepEqual(matchRoute(routes(), "/sign-up/a/b").params, { "sign-up": ["a", "b"] });
});

test("unknown paths do not match and params are decoded", () => {
  assert.equal(matchRoute(routes(), "/nope"), null);
  assert.deepEqual(matchRoute(routes(), "/posts/a%20b").params, { id: "a b" });
  assert.equal(matchRoute(routes(), "/").route.pattern, "/");
});

test("scanPagesDir names _app, _document and 404 as special files", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { scanPagesDir } = await import("../src/routing/pages-routes.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-pages-"));
  for (const f of ["_app.tsx", "_document.tsx", "404.tsx", "index.tsx"]) fs.writeFileSync(path.join(dir, f), "");
  const scan = scanPagesDir(dir);
  assert.equal(scan.special.app, path.join(dir, "_app.tsx"));
  assert.equal(scan.special.document, path.join(dir, "_document.tsx"));
  assert.equal(scan.special["404"], path.join(dir, "404.tsx"));
  assert.deepEqual(scan.pages.map((r) => r.pattern), ["/", "/404"]);
  fs.rmSync(dir, { recursive: true });
});
