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
      `const get = __vinext_cacheRef\\("m\\.js:${arrow.start}", async \\(\\) => \\{ return __vinext_useCache\\("m\\.js:${arrow.start}", \\[\\], async \\(\\) => \\{ return u; \\}, \\{ u \\}\\); \\}, \\(\\) => \\(\\{ u \\}\\), "get"\\); \\}$`,
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
  // Each made once, as a module makes them.
  const [memoA, memoB, refA, refB] = [memo(() => {}), memo(() => {}), forwardRef(() => {}), forwardRef(() => {})];
  assert.equal(await run(element(memoA)), 1);
  assert.equal(await run(element(memoA)), 1);
  assert.equal(await run(element(memoB)), 2);
  assert.equal(await run(element(refA)), 3);
  assert.equal(await run(element(refA)), 3);
  assert.equal(await run(element(refB)), 4);
});

test("closed-over elements of different components with one name key apart", async () => {
  let calls = 0;
  const run = (el) => __vinext_useCache("t:9", [], async () => ++calls, { el });
  const element = (type) => ({ $$typeof: Symbol.for("react.transitional.element"), type, key: null, props: {} });
  const cards = [0, 1].map(() => function Card() {});
  assert.equal(await run(element(cards[0])), 1);
  assert.equal(await run(element(cards[0])), 1);
  assert.equal(await run(element(cards[1])), 2);
});

test("a closed-over value with toJSON keys as what toJSON gives, as React serializes it", async () => {
  let calls = 0;
  const run = (v) => __vinext_useCache("t:10", [], async () => ++calls, { v });
  assert.equal(await run(new URL("https://x.test/a")), 1);
  assert.equal(await run(new URL("https://x.test/a")), 1);
  assert.equal(await run(new URL("https://x.test/b")), 2);
});

test("a marked function keeps the name it was given", () => {
  const fn = __vinext_cacheRef("t:name", async () => {}, null, "Get");
  assert.equal(fn.name, "Get");
});

test("a cached function declaration in a class static block is marked where the block starts", () => {
  const code = 'function Page(u) { class C { static { C.x = 1; async function get() { "use cache"; return u; } } } }';
  const start = code.indexOf("async function");
  const body = { type: "BlockStatement", start: code.indexOf("{", start), end: code.indexOf("} }", start) + 1 };
  const d = code.indexOf('"use cache";');
  body.body = [{ type: "ExpressionStatement", directive: "use cache", start: d, end: d + 12 }, { type: "ReturnStatement", argument: I("u") }];
  const get = { type: "FunctionDeclaration", async: true, id: I("get"), params: [], start, end: body.end, body };
  const first = { type: "ExpressionStatement", start: code.indexOf("C.x"), end: code.indexOf("C.x") + 8, expression: { type: "Literal" } };
  const cls = { type: "ClassDeclaration", id: I("C"), body: { type: "ClassBody", body: [{ type: "StaticBlock", start: code.indexOf("static"), body: [first, get] }] } };
  const page = { type: "FunctionDeclaration", id: I("Page"), params: [I("u")], body: block([cls]) };
  const out = transformUseCache(code, { type: "Program", body: [page] }, "k.js");
  assert.match(out, new RegExp(`static \\{ __vinext_cacheRef\\("k\\.js:${start}", get, \\(\\) => \\(\\{ u \\}\\)\\); C\\.x = 1;`));
});

test("a wrapped function expression takes its name from a numeric or private key", () => {
  const code = 'function P() { const o = { 1: async () => { "use cache"; return 1; } }; }';
  const arrow = cachedArrow(code, [{ type: "ReturnStatement", argument: { type: "Literal" } }]);
  arrow.end = arrow.body.end = code.indexOf("} }") + 1;
  const prop = (key) => ({ type: "Property", kind: "init", computed: false, key, value: arrow });
  const page = (key) => ({
    type: "FunctionDeclaration",
    id: I("P"),
    params: [],
    body: block([decl("const", "o", { type: "ObjectExpression", properties: [prop(key)] })]),
  });
  assert.match(transformUseCache(code, { type: "Program", body: [page({ type: "Literal", value: 1 })] }, "q.js"), /, null, "1"\)/);
  const field = { type: "PropertyDefinition", computed: false, key: { type: "PrivateIdentifier", name: "y" }, value: arrow };
  const cls = { type: "ClassDeclaration", id: I("C"), body: { type: "ClassBody", body: [field] } };
  const withField = { type: "FunctionDeclaration", id: I("P"), params: [], body: block([cls]) };
  assert.match(transformUseCache(code, { type: "Program", body: [withField] }, "q.js"), /, null, "#y"\)/);
});

test("a mark at the start of a case goes ahead of an edit at the same offset", () => {
  const code = 'function P(u) { switch (u) { case 1: async function get() { "use cache"; return u; } case 2: async () => { "use cache"; return u; }; } }';
  const start = code.indexOf("async function");
  const body = { type: "BlockStatement", start: code.indexOf("{", start), end: code.indexOf("} case 2") + 1 };
  const d = code.indexOf('"use cache";');
  body.body = [{ type: "ExpressionStatement", directive: "use cache", start: d, end: d + 12 }, { type: "ReturnStatement", argument: I("u") }];
  const get = { type: "FunctionDeclaration", async: true, id: I("get"), params: [], start, end: body.end, body };
  const arrow = cachedArrow(code, [{ type: "ReturnStatement", argument: I("u") }]);
  const stmt = { type: "ExpressionStatement", start: arrow.start, end: arrow.end + 1, expression: arrow };
  const sw = {
    type: "SwitchStatement",
    discriminant: I("u"),
    cases: [
      { type: "SwitchCase", test: { type: "Literal" }, consequent: [get] },
      { type: "SwitchCase", test: { type: "Literal" }, consequent: [stmt] },
    ],
  };
  const page = { type: "FunctionDeclaration", id: I("P"), params: [I("u")], body: block([sw]) };
  const out = transformUseCache(code, { type: "Program", body: [page] }, "v.js");
  assert.match(out, /case 2: __vinext_cacheRef\("v\.js:\d+", get, \(\) => \(\{ u \}\)\); __vinext_cacheRef\("v\.js:\d+", async/);
});

test("a 'use cache' function reading arguments is refused, as Next.js refuses it", () => {
  const code = 'function Page() { const get = async () => { "use cache"; return arguments[0]; }; }';
  const read = { type: "MemberExpression", computed: true, object: I("arguments"), property: { type: "Literal" } };
  const ret = { type: "ReturnStatement", argument: read };
  const run = (statements, params = []) => {
    const arrow = cachedArrow(code, statements);
    arrow.params = params;
    const page = { type: "FunctionDeclaration", id: I("Page"), params: [], body: block([decl("const", "get", arrow)]) };
    return () => transformUseCache(code, { type: "Program", body: [page] }, "g.js");
  };
  const refused = /"use cache" functions cannot use `arguments`/;
  // An arrow's arguments are its enclosing function's.
  assert.throws(run([ret]), refused);
  // So are those of an arrow inside it, or read in a parameter's default.
  const inner = { type: "ArrowFunctionExpression", params: [], body: read };
  assert.throws(run([{ type: "ReturnStatement", argument: inner }]), refused);
  assert.throws(run([], [{ type: "AssignmentPattern", left: I("a"), right: read }]), refused);
  // A function's own arguments.
  const fnCode = 'async function get() { "use cache"; return arguments[0]; }';
  const ast = fnAst(fnCode);
  ast.body[0].body.body.push(ret);
  assert.throws(() => transformUseCache(fnCode, ast, "g.js"), refused);
  // Not a function's inside it, nor a property or key named arguments.
  const own = { type: "FunctionExpression", params: [], body: block([ret]) };
  assert.ok(run([{ type: "ReturnStatement", argument: own }])());
  const prop = { type: "MemberExpression", computed: false, object: I("x"), property: I("arguments") };
  const obj = { type: "ObjectExpression", properties: [{ type: "Property", key: I("arguments"), computed: false, value: { type: "Literal" } }] };
  assert.ok(run([{ type: "ReturnStatement", argument: { type: "ArrayExpression", elements: [prop, obj] } }])());
});

test("arguments key by content as closed-over values do", async () => {
  let calls = 0;
  const run = (...args) => __vinext_useCache("t:args", args, async () => ++calls);
  const first = await run(NaN);
  assert.equal(await run(NaN), first);
  assert.notEqual(await run(null), first);
  const m = await run(new Map([["a", 1]]));
  assert.equal(await run(new Map([["a", 1]])), m);
  assert.notEqual(await run(new Map([["a", 2]])), m);
});

test("a call passed a function or class instance is not cached, as Next.js passes them through unkeyed", async () => {
  let calls = 0;
  const run = (v) => __vinext_useCache("t:temp", [v], async () => ++calls);
  const f = () => 1;
  assert.equal(await run(f), 1);
  assert.equal(await run(f), 2);
  const c = new (class Clock {})();
  assert.equal(await run(c), 3);
  assert.equal(await run(c), 4);
  await assert.rejects(run(Symbol("local")), /Only global symbols/);
  // Its closed-over values are still keyed: refused, or awaited.
  const withClosure = (closure) => __vinext_useCache("t:temp", [f], async () => ++calls, closure);
  await assert.rejects(withClosure({ g: () => 2 }), /reads g .*Functions cannot be passed directly/);
  await assert.rejects(withClosure({ p: Promise.reject(new Error("gone")) }), /gone/);
  assert.equal(calls, 4);
});

test("a value shared between an argument and a closed-over value keys as one, as React encodes them together", async () => {
  let calls = 0;
  const run = (a, v) => __vinext_useCache("t:share", [a], async () => ++calls, { v });
  const shared = { n: 1 };
  assert.notEqual(await run(shared, shared), await run({ n: 1 }, { n: 1 }));
});

test("a closed-over value that refers to itself is keyed, as React serializes cycles", async () => {
  let calls = 0;
  const run = (v) => __vinext_useCache("t:cycle", [], async () => ++calls, { v });
  const cyclic = () => {
    const a = { n: 1 };
    a.self = a;
    return a;
  };
  const first = await run(cyclic());
  assert.equal(await run(cyclic()), first);
  const b = { n: 1, self: { n: 1 } };
  assert.notEqual(await run(b), first);
  const shared = { n: 1 };
  assert.notEqual(await run([shared, shared]), await run([{ n: 1 }, { n: 1 }]));
  const d = new Date(0);
  assert.equal(await run([d, d]), await run([new Date(0), new Date(0)]));
});

test("a rejected closed-over promise rejects the call, as encodeReply does", async () => {
  let calls = 0;
  const run = (p) => __vinext_useCache("t:reject", [], async () => ++calls, { p });
  await assert.rejects(run(Promise.reject(new Error("gone"))), /gone/);
  await assert.rejects(run(Promise.reject(new Error("gone"))), /gone/);
  assert.equal(calls, 0);
});

test("a 'use cache' function reading this is refused, as Next.js refuses it", () => {
  // function Page() { const get = async () => { "use cache"; return this.x; }; }
  const code = 'function Page() { const get = async () => { "use cache"; return this.x; }; }';
  const thisX = { type: "MemberExpression", object: { type: "ThisExpression" }, property: I("x"), computed: false };
  const arrow = cachedArrow(code, [{ type: "ReturnStatement", argument: thisX }]);
  const page = { type: "FunctionDeclaration", id: I("Page"), params: [], body: block([decl("const", "get", arrow)]) };
  assert.throws(() => transformUseCache(code, { type: "Program", body: [page] }, "t.js"), /"use cache" functions cannot use `this`/);
  thisX.object = { type: "Super" };
  assert.throws(() => transformUseCache(code, { type: "Program", body: [page] }, "t.js"), /"use cache" functions cannot use `super`/);
  thisX.object = { type: "ThisExpression" };
  // A computed class member key reads the cached function's own this.
  const klass = { type: "ClassExpression", body: { type: "ClassBody", body: [{ type: "MethodDefinition", computed: true, key: thisX, value: { type: "FunctionExpression", params: [], body: block([]) } }] } };
  const arrow4 = cachedArrow(code, [{ type: "ReturnStatement", argument: klass }]);
  const page4 = { type: "FunctionDeclaration", id: I("Page"), params: [], body: block([decl("const", "get", arrow4)]) };
  assert.throws(() => transformUseCache(code, { type: "Program", body: [page4] }, "t.js"), /"use cache" functions cannot use `this`/);
  // A function inside it has its own this.
  const own = { type: "FunctionExpression", params: [], body: block([{ type: "ReturnStatement", argument: thisX }]) };
  const code2 = 'function Page() { const get = async () => { "use cache"; return function () {}; }; }';
  const arrow2 = cachedArrow(code2, [{ type: "ReturnStatement", argument: own }]);
  const page2 = { type: "FunctionDeclaration", id: I("Page"), params: [], body: block([decl("const", "get", arrow2)]) };
  assert.ok(transformUseCache(code2, { type: "Program", body: [page2] }, "t.js"));
  // Nor is the this the dev JSX runtime is handed (the check runs after JSX is compiled).
  const jsx = { type: "CallExpression", callee: I("_jsxDEV"), arguments: [I("a"), I("b"), I("c"), I("d"), I("e"), { type: "ThisExpression" }] };
  const arrow3 = cachedArrow(code2, [{ type: "ReturnStatement", argument: jsx }]);
  const page3 = { type: "FunctionDeclaration", id: I("Page"), params: [], body: block([decl("const", "get", arrow3)]) };
  assert.ok(transformUseCache(code2, { type: "Program", body: [page3] }, "t.js"));
});
