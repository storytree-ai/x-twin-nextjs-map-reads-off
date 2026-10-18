import { test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import assert from "node:assert/strict";
import { transformUseCache } from "../src/plugins/use-cache.js";
import { __vinext_cacheRef, __vinext_useCache, cacheLife, cacheTag, revalidateTag } from "../src/shims/cache.js";

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
  const arrowBody = { type: "BlockStatement", start: at("{", arrowStart), end: at("}; }", arrowStart) + 1 };
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
  assert.match(out, new RegExp(`__vinext_useCache\\("p\\.js:${arrowStart}", \\[\\], async \\(\\) => \\{ return userId \\+ obj\\.label; \\}, \\{ userId \\}\\); \\}`));
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

// Builders for the ESTree nodes the tests below hand to transformUseCache;
// only the cached function and its directive carry offsets.
const I = (name) => ({ type: "Identifier", name });
const block = (body) => ({ type: "BlockStatement", body });
const decl = (kind, name, init = { type: "Literal" }) => ({
  type: "VariableDeclaration",
  kind,
  declarations: [{ type: "VariableDeclarator", id: I(name), init }],
});
/** The `async () => { "use cache"; ... }` arrow at its offset in code, with the given statements after the directive. */
function cachedArrow(code, statements) {
  const start = code.indexOf("async () => {");
  const body = { type: "BlockStatement", start: code.indexOf("{", start), end: code.indexOf("}; }", start) + 1 };
  const d = code.indexOf('"use cache";', start);
  body.body = [{ type: "ExpressionStatement", directive: "use cache", start: d, end: d + 12 }, ...statements];
  return { type: "ArrowFunctionExpression", async: true, params: [], start, end: body.end, body };
}

test("closed-over names follow block scope", () => {
  const code =
    'function Page(c, e) { if (c) { const a = 1; var b = 2; } { const d = 3; const get = async () => { "use cache"; { const e = 0; } return [a, b, d, e]; }; } }';
  const arrow = cachedArrow(code, [
    block([decl("const", "e")]),
    { type: "ReturnStatement", argument: { type: "ArrayExpression", elements: [I("a"), I("b"), I("d"), I("e")] } },
  ]);
  const page = {
    type: "FunctionDeclaration",
    id: I("Page"),
    params: [I("c"), I("e")],
    body: block([
      { type: "IfStatement", test: I("c"), consequent: block([decl("const", "a"), decl("var", "b")]) },
      block([decl("const", "d"), decl("const", "get", arrow)]),
    ]),
  };
  const out = transformUseCache(code, { type: "Program", body: [page] }, "s.js");
  // a is const in a block the cached function is not in; b is var (the whole of Page's);
  // the e the cached function returns is Page's parameter, not its own block's.
  assert.match(out, /return \[a, b, d, e\]; \}, \{ b, d, e \}\); \}/);
});

test("an inline cached function is marked, so another cached function may close over it", () => {
  const code = 'function Page(u) { const get = async () => { "use cache"; return u; }; }';
  const arrow = cachedArrow(code, [{ type: "ReturnStatement", argument: I("u") }]);
  const page = { type: "FunctionDeclaration", id: I("Page"), params: [I("u")], body: block([decl("const", "get", arrow)]) };
  const out = transformUseCache(code, { type: "Program", body: [page] }, "m.js");
  assert.match(out, /^import \{ __vinext_useCache, __vinext_cacheRef \} from "next\/cache";/);
  assert.match(
    out,
    new RegExp(
      `const get = __vinext_cacheRef\\("m\\.js:${arrow.start}", async \\(\\) => \\{ return __vinext_useCache\\("m\\.js:${arrow.start}", \\[\\], async \\(\\) => \\{ return u; \\}, \\{ u \\}\\); \\}, \\(\\) => \\(\\{ u \\}\\)\\); \\}$`,
    ),
  );
});

test("closed-over values key the entry, and a function among them is refused", async () => {
  let calls = 0;
  const run = (closure) => __vinext_useCache("t:3", [], async () => ++calls, closure);
  assert.equal(await run({ user: 1n, tags: new Set(["a"]) }), 1);
  assert.equal(await run({ user: 1n, tags: new Set(["a"]) }), 1);
  assert.equal(await run({ user: 1n, tags: new Set(["b"]) }), 2);
  await assert.rejects(run({ format: () => "x" }), /reads format .*Functions cannot be passed directly/);
  await assert.rejects(run({ when: new (class Clock {})() }), /Classes or null prototypes are not supported/);
  assert.equal(calls, 2);
});

test("a closed-over cached function or server action keys by its id and its own closure", async () => {
  let calls = 0;
  const inner = (user) => __vinext_cacheRef("t:inner", async () => user, () => ({ user }));
  const run = (getUser) => __vinext_useCache("t:4", [], async () => ++calls, { getUser });
  assert.equal(await run(inner(1)), 1);
  assert.equal(await run(inner(1)), 1);
  assert.equal(await run(inner(2)), 2);
  const action = Object.assign(async () => {}, { $$typeof: Symbol.for("react.server.reference"), $$id: "act#1", $$bound: null });
  assert.equal(await run(action), 3);
  assert.equal(await run(action), 3);
});

test("a cached function that closes over itself keys once round the loop", async () => {
  let calls = 0;
  const self = __vinext_cacheRef("t:self", async () => 1, () => ({ self }));
  const run = () => __vinext_useCache("t:5", [], async () => ++calls, { self });
  assert.equal(await run(), 1);
  assert.equal(await run(), 1);
});

test("a cached function declaration is marked where its block starts, as it is hoisted", () => {
  const code = 'function Page(u) { return 1; async function get() { "use cache"; return u; } }';
  const start = code.indexOf("async function");
  const body = { type: "BlockStatement", start: code.indexOf("{", start), end: code.length - 2 };
  const d = code.indexOf('"use cache";');
  body.body = [{ type: "ExpressionStatement", directive: "use cache", start: d, end: d + 12 }, { type: "ReturnStatement", argument: I("u") }];
  const get = { type: "FunctionDeclaration", async: true, id: I("get"), params: [], start, end: body.end, body };
  const pageBody = { type: "BlockStatement", start: code.indexOf("{"), end: code.length, body: [{ type: "ReturnStatement" }, get] };
  const page = { type: "FunctionDeclaration", id: I("Page"), params: [I("u")], body: pageBody };
  const out = transformUseCache(code, { type: "Program", body: [page] }, "h.js");
  assert.match(out, new RegExp(`function Page\\(u\\) \\{ __vinext_cacheRef\\("h\\.js:${start}", get, \\(\\) => \\(\\{ u \\}\\)\\); return 1; async function get\\(\\) \\{ return __vinext_useCache`));
});

test("a closed-over promise keys by what it resolves to", async () => {
  let calls = 0;
  const run = (params) => __vinext_useCache("t:6", [], async () => ++calls, { params });
  assert.equal(await run(Promise.resolve({ id: 1 })), 1);
  assert.equal(await run(Promise.resolve({ id: 1 })), 1);
  assert.equal(await run(Promise.resolve({ id: 2 })), 2);
});

test("closed-over values that only look alike key apart", async () => {
  let calls = 0;
  const run = (v) => __vinext_useCache("t:7", [], async () => ++calls, { v });
  const pairs = [
    [new Map([["a", 1]]), { $map: [["a", 1]] }],
    [1n, { $bigint: "1" }],
    [NaN, null],
    [new Date(0), new Date(0).toISOString()],
    [[undefined], [null]],
  ];
  for (const [a, b] of pairs) {
    const first = await run(a);
    assert.equal(await run(a), first);
    assert.notEqual(await run(b), first, `${String(a)} and ${JSON.stringify(b)} share a key`);
  }
});

test("a cached function declaration in a switch case is marked at every case", () => {
  const code = 'function Page(u) { switch (u) { case 1: return 1; case 2: async function get() { "use cache"; return u; } } }';
  const start = code.indexOf("async function");
  const body = { type: "BlockStatement", start: code.indexOf("{", start), end: code.indexOf("} }", start) + 1 };
  const d = code.indexOf('"use cache";');
  body.body = [{ type: "ExpressionStatement", directive: "use cache", start: d, end: d + 12 }, { type: "ReturnStatement", argument: I("u") }];
  const get = { type: "FunctionDeclaration", async: true, id: I("get"), params: [], start, end: body.end, body };
  const ret = { type: "ReturnStatement", start: code.indexOf("return 1"), end: code.indexOf("return 1") + 9 };
  const sw = {
    type: "SwitchStatement",
    discriminant: I("u"),
    cases: [
      { type: "SwitchCase", test: { type: "Literal" }, consequent: [ret] },
      { type: "SwitchCase", test: { type: "Literal" }, consequent: [get] },
    ],
  };
  const page = { type: "FunctionDeclaration", id: I("Page"), params: [I("u")], body: block([sw]) };
  const out = transformUseCache(code, { type: "Program", body: [page] }, "w.js");
  const mark = `__vinext_cacheRef\\("w\\.js:${start}", get, \\(\\) => \\(\\{ u \\}\\)\\); `;
  assert.match(out, new RegExp(`case 1: ${mark}return 1; case 2: ${mark}async function get`));
});

test("a var in a class static block is the static block's", () => {
  const code = 'function Page() { class C { static { var v = 1; } } const get = async () => { "use cache"; return v; }; }';
  const arrow = cachedArrow(code, [{ type: "ReturnStatement", argument: I("v") }]);
  const cls = { type: "ClassDeclaration", id: I("C"), body: { type: "ClassBody", body: [{ type: "StaticBlock", body: [decl("var", "v")] }] } };
  const page = { type: "FunctionDeclaration", id: I("Page"), params: [], body: block([cls, decl("const", "get", arrow)]) };
  assert.match(transformUseCache(code, { type: "Program", body: [page] }, "c.js"), /return v; \}\); \}/);
});

test("closed-over elements of different memo or forwardRef components key apart", async () => {
  let calls = 0;
  const run = (el) => __vinext_useCache("t:8", [], async () => ++calls, { el });
  const element = (type) => ({ $$typeof: Symbol.for("react.transitional.element"), type, key: null, props: {} });
  const memo = (type) => ({ $$typeof: Symbol.for("react.memo"), type });
  const forwardRef = (render) => ({ $$typeof: Symbol.for("react.forward_ref"), render });
  const A = function A() {};
  const B = function B() {};
  assert.equal(await run(element(memo(A))), 1);
  assert.equal(await run(element(memo(A))), 1);
  assert.equal(await run(element(memo(B))), 2);
  assert.equal(await run(element(forwardRef(A))), 3);
  assert.equal(await run(element(forwardRef(B))), 4);
});
