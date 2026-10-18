import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanAppDir, matchAppRoute } from "../src/routing/app-routes.js";

function makeApp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vinext-app-routes-"));
  for (const f of files) {
    const abs = path.join(dir, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "export default function X() { return null }\n");
  }
  return dir;
}

const app = makeApp([
  "layout.tsx",
  "page.tsx",
  "not-found.tsx",
  "template.tsx",
  "about/page.tsx",
  "(marketing)/features/page.tsx",
  "blog/[slug]/page.tsx",
  "blog/[slug]/layout.tsx",
  "docs/[...slug]/page.tsx",
  "optional/[[...path]]/page.tsx",
  "dashboard/layout.tsx",
  "dashboard/not-found.tsx",
  "dashboard/page.tsx",
  "dashboard/@team/page.tsx",
  "dashboard/missing/page.tsx",
  "%5Fsites/[subdomain]/page.tsx",
  "_private/page.tsx",
  "api/hello/route.ts",
  "locale/[locale]/page.tsx",
  "locale/[locale]/blog/page.tsx",
  "locale/[locale]/blog/[...path]/page.tsx",
  "locale/[locale]/[...path]/page.tsx",
  "components/counter.tsx",
]);
const scan = scanAppDir(app);
const match = (p) => matchAppRoute(scan.routes, p);

test("pages and route handlers map to URL patterns; groups and private folders vanish", () => {
  const patterns = scan.routes.map((r) => r.pattern).sort();
  assert.ok(patterns.includes("/"));
  assert.ok(patterns.includes("/features"));
  assert.ok(patterns.includes("/_sites/[subdomain]"));
  assert.ok(!patterns.some((p) => p.includes("_private") || p.includes("components") || p.includes("@team")));
  assert.equal(match("/api/hello").route.kind, "route");
  assert.equal(match("/about").route.kind, "page");
  assert.deepEqual(match("/_sites/acme").params, { subdomain: "acme" });
});

test("dynamic, catch-all and optional catch-all segments give params", () => {
  assert.deepEqual(match("/blog/hello").params, { slug: "hello" });
  assert.deepEqual(match("/docs/a/b/c").params, { slug: ["a", "b", "c"] });
  assert.equal(match("/docs"), null);
  assert.deepEqual(match("/optional").params, {});
  assert.deepEqual(match("/optional/x/y").params, { path: ["x", "y"] });
});

test("a static infix catch-all beats a bare catch-all", () => {
  assert.equal(match("/locale/en/blog/intro").route.pattern, "/locale/[locale]/blog/[...path]");
  assert.equal(match("/locale/en/blog").route.pattern, "/locale/[locale]/blog");
  assert.equal(match("/locale/en/learn/x").route.pattern, "/locale/[locale]/[...path]");
});

test("a route carries its layout chain and the not-found files along it", () => {
  const r = match("/dashboard/missing").route;
  const layouts = r.levels.filter((l) => l.layout).map((l) => path.relative(app, l.layout));
  assert.deepEqual(layouts, ["layout.tsx", path.join("dashboard", "layout.tsx")]);
  const notFounds = r.levels.filter((l) => l.notFound).map((l) => path.relative(app, l.notFound));
  assert.deepEqual(notFounds, ["not-found.tsx", path.join("dashboard", "not-found.tsx")]);
  assert.equal(path.relative(app, r.levels[0].template), "template.tsx");
  // A layout only sees the params of its own segment and above.
  const blog = match("/blog/x").route;
  const slugLevel = blog.levels.find((l) => l.layout && l.layout.includes("[slug]"));
  assert.deepEqual(slugLevel.paramNames, ["slug"]);
  assert.deepEqual(blog.levels[0].paramNames, []);
});
