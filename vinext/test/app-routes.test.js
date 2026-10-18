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

test("parallel @slots: each route gets the slot page for its URL, else the slot's default", () => {
  const dir = makeApp([
    "layout.tsx",
    "dash/layout.tsx",
    "dash/page.tsx",
    "dash/default.tsx",
    "dash/settings/page.tsx",
    "dash/@team/page.tsx",
    "dash/@team/default.tsx",
    "dash/@team/layout.tsx",
    "dash/@team/members/page.tsx",
    "dash/@stats/page.tsx",
  ]);
  const { routes } = scanAppDir(dir);
  const at = (p) => matchAppRoute(routes, p).route;
  const slotsOf = (r) =>
    Object.fromEntries(
      Object.entries(r.slots).map(([i, list]) => [i, list.map((s) => `${s.name}:${path.relative(dir, s.file)}`)]),
    );

  assert.deepEqual(slotsOf(at("/dash")), {
    1: [`stats:${path.join("dash", "@stats", "page.tsx")}`, `team:${path.join("dash", "@team", "page.tsx")}`],
  });
  // No @stats default and no settings page in either slot: team falls back to default, stats to nothing.
  assert.deepEqual(slotsOf(at("/dash/settings")), { 1: [`team:${path.join("dash", "@team", "default.tsx")}`] });
  // A URL only a slot has is a route whose children render the level's default.tsx.
  const members = at("/dash/members");
  assert.equal(path.relative(dir, members.file), path.join("dash", "default.tsx"));
  assert.deepEqual(slotsOf(members), { 1: [`team:${path.join("dash", "@team", "members", "page.tsx")}`] });
  // The slot's own layout wraps what it renders.
  const team = members.slots[1][0];
  assert.deepEqual(team.levels.filter((l) => l.layout).map((l) => path.relative(dir, l.layout)), [path.join("dash", "@team", "layout.tsx")]);
  // Slot folders are not routes of their own.
  assert.equal(matchAppRoute(routes, "/dash/team"), null);
});

test("each level knows its folder name, for useSelectedLayoutSegments", () => {
  const r = match("/features").route;
  assert.deepEqual(r.levels.map((l) => l.segment), ["", "(marketing)", "features"]);
});

test("intercepting folders in a slot cover the URLs they name, from the slot's level", () => {
  const dir = makeApp([
    "layout.tsx",
    "feed/layout.tsx",
    "feed/page.tsx",
    "feed/@modal/default.tsx",
    "feed/@modal/(...)photos/[id]/page.tsx",
    "feed/@modal/(.)item/[n]/page.tsx",
    "photos/[id]/page.tsx",
  ]);
  const { routes, interceptions } = scanAppDir(dir);
  const byPattern = Object.fromEntries(interceptions.map((i) => [i.pattern, i]));
  assert.deepEqual(Object.keys(byPattern).sort(), ["/feed/item/[n]", "/photos/[id]"]);
  const photo = byPattern["/photos/[id]"];
  assert.equal(photo.slot, "modal");
  assert.equal(photo.sourceDir, path.join(dir, "feed"));
  assert.equal(path.relative(dir, photo.file), path.join("feed", "@modal", "(...)photos", "[id]", "page.tsx"));
  assert.deepEqual(matchAppRoute(interceptions, "/photos/7").params, { id: "7" });
  // Intercepting folders are not routes of their own; the real page still is.
  assert.equal(matchAppRoute(routes, "/photos/7").route.pattern, "/photos/[id]");
  assert.equal(matchAppRoute(routes, "/feed/item/1"), null);
  assert.ok(matchAppRoute(routes, "/feed").route.levels.some((l) => l.dir === photo.sourceDir));
});
