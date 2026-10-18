import { test } from "node:test";
import assert from "node:assert/strict";
import { transformUseCache } from "../src/plugins/use-cache.js";
import { __vinext_useCache, cacheLife, cacheTag, revalidateTag } from "../src/shims/cache.js";

// Minimal ESTree nodes with start/end offsets, as Vite's parseAst gives them.
function fnAst(code) {
  // async function getData(a) { "use cache"; return a; }
  const body = { type: "BlockStatement", start: code.indexOf("{"), end: code.lastIndexOf("}") + 1 };
  const d = code.indexOf('"use cache";');
  body.body = [{ type: "ExpressionStatement", directive: "use cache", start: d, end: d + '"use cache";'.length }];
  const fn = { type: "FunctionDeclaration", async: true, start: 0, end: code.length, body, params: [] };
  return { type: "Program", body: [fn] };
}

test("a function-level 'use cache' body runs through the cache wrapper", () => {
  const code = 'async function getData(a) { "use cache"; return a; }';
  const out = transformUseCache(code, fnAst(code), "app/page.tsx");
  assert.match(out, /^import \{ __vinext_useCache \} from "next\/cache";/);
  assert.match(
    out,
    /async function getData\(a\) \{ return __vinext_useCache\("app\/page\.tsx:0", Array\.from\(arguments\), async \(\) => \{ return a; \}\); \}$/,
  );
});

test("files without the directive are left alone", () => {
  const code = "async function f() { return 1; }";
  assert.equal(transformUseCache(code, { type: "Program", body: [] }, "x.ts"), null);
});

test("cached results are reused until their cacheLife revalidate passes, and dropped by their tag", async () => {
  let calls = 0;
  const run = () =>
    __vinext_useCache("t:1", [1], async () => {
      cacheLife({ revalidate: 0.05, expire: 0.05 });
      cacheTag("tag-a");
      return ++calls;
    });
  assert.equal(await run(), 1);
  assert.equal(await run(), 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(await run(), 2);
  revalidateTag("tag-a");
  assert.equal(await run(), 3);
});
