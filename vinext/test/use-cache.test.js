import { test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
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

test("an arrow function's parameters key its cache entry", () => {
  // const get = async (id, { lang = "en" }) => { "use cache"; return id; }
  const code = 'const get = async (id, { lang = "en" }) => { "use cache"; return id; }';
  const ast = fnAst(code);
  const fn = ast.body[0];
  fn.type = "ArrowFunctionExpression";
  fn.params = [
    { type: "Identifier", name: "id" },
    { type: "ObjectPattern", properties: [{ type: "Property", value: { type: "AssignmentPattern", left: { type: "Identifier", name: "lang" } } }] },
  ];
  assert.match(transformUseCache(code, ast, "a.ts"), /__vinext_useCache\("a\.ts:0", \[id, lang\], async/);
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

test("cacheTag and cacheLife still apply after an await", async () => {
  globalThis.__VINEXT_SSR_ALS__ ??= new AsyncLocalStorage();
  let calls = 0;
  const run = () =>
    __vinext_useCache("t:2", [], async () => {
      await new Promise((r) => setTimeout(r, 1));
      cacheTag("late-tag");
      return ++calls;
    });
  assert.equal(await run(), 1);
  assert.equal(await run(), 1);
  revalidateTag("late-tag");
  assert.equal(await run(), 2);
});

test("an inline cached function keys on the outer values it reads", () => {
  // function Page({ userId }) { const label = "x"; const get = async () => { "use cache"; return userId + obj.label; }; }
  const code =
    'function Page({ userId }) { const label = "x"; const get = async () => { "use cache"; return userId + obj.label; }; }';
  const at = (s, from = 0) => code.indexOf(s, from);
  const id = (name, start) => ({ type: "Identifier", name, start, end: start + name.length });
  const arrowStart = at("async ()");
  const arrowBody = { type: "BlockStatement", start: at("{", arrowStart), end: at("; }", arrowStart) + 1 };
  const d = at('"use cache";');
  arrowBody.body = [
    { type: "ExpressionStatement", directive: "use cache", start: d, end: d + 12 },
    {
      type: "ReturnStatement",
      argument: {
        type: "BinaryExpression",
        left: id("userId", at("userId +")),
        right: { type: "MemberExpression", computed: false, object: id("obj", at("obj")), property: id("label", at("label;")) },
      },
    },
  ];
  const arrow = { type: "ArrowFunctionExpression", async: true, params: [], start: arrowStart, end: arrowBody.end, body: arrowBody };
  const outerBody = {
    type: "BlockStatement",
    start: at("{ const"),
    end: code.length,
    body: [
      { type: "VariableDeclaration", declarations: [{ type: "VariableDeclarator", id: id("label", at("label =")), init: { type: "Literal" } }] },
      { type: "VariableDeclaration", declarations: [{ type: "VariableDeclarator", id: id("get", at("get")), init: arrow }] },
    ],
  };
  const page = {
    type: "FunctionDeclaration",
    id: id("Page", 9),
    start: 0,
    end: code.length,
    params: [{ type: "ObjectPattern", properties: [{ type: "Property", shorthand: true, key: id("userId", at("userId")), value: id("userId", at("userId")) }] }],
    body: outerBody,
  };
  const out = transformUseCache(code, { type: "Program", body: [page] }, "p.js");
  // userId is Page's; obj is not bound in Page; .label is a property, not the outer label.
  assert.match(out, new RegExp(`__vinext_useCache\\("p\\.js:${arrowStart}", \\[\\[\\], \\[userId\\]\\], async`));
});

test("a file-level 'use cache' wraps every exported async function", () => {
  const code = '"use cache"; export async function get(a) { return a; }';
  const fnStart = code.indexOf("async");
  const body = { type: "BlockStatement", start: code.indexOf("{"), end: code.length, body: [] };
  const fn = { type: "FunctionDeclaration", async: true, start: fnStart, end: code.length, body, params: [] };
  const ast = {
    type: "Program",
    body: [
      { type: "ExpressionStatement", directive: "use cache", start: 0, end: 12 },
      { type: "ExportNamedDeclaration", declaration: fn },
    ],
  };
  assert.match(
    transformUseCache(code, ast, "f.js"),
    new RegExp(`export async function get\\(a\\) \\{return __vinext_useCache\\("f\\.js:${fnStart}", Array\\.from\\(arguments\\), async \\(\\) => \\{ return a; \\}\\); \\}$`),
  );
});
