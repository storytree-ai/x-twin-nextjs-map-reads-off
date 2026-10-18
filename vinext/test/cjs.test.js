import { test } from "node:test";
import assert from "node:assert/strict";
import { transformCjs } from "../src/plugins/cjs.js";

test("require() of a string becomes a hoisted import read through interop", () => {
  const out = transformCjs(`const { random } = require("./random");\nexport default function Page() {}`);
  assert.match(out, /^import \* as __vinext_req_0 from "\.\/random";/);
  assert.match(out, /const \{ random \} = __vinext_cjs_interop\(__vinext_req_0\);/);
});

test("module.exports without ESM exports becomes the default export", () => {
  const out = transformCjs(`module.exports = {\n  random: () => 4,\n};\n`);
  assert.match(out, /var module = \{ exports: \{\} \}; var exports = module\.exports;/);
  assert.match(out, /export default module\.exports;/);
  assert.match(out, /export const __vinext_cjs = true;/);
});

test("interop hands back module.exports for CommonJS and the namespace for ESM", async () => {
  const { __vinext_cjs_interop } = await import("../src/plugins/cjs.js");
  assert.deepEqual(__vinext_cjs_interop({ default: { a: 1 }, __vinext_cjs: true }), { a: 1 });
  const ns = { default: 1, x: 2 };
  assert.equal(__vinext_cjs_interop(ns), ns);
});

test("plain ES modules are left alone", () => {
  assert.equal(transformCjs(`import x from "y";\nexport const a = x;`), null);
  assert.equal(transformCjs(`// require("x") in a comment\nexport const required = 1;`), null);
});

test("a 'use client' directive stays first", () => {
  const out = transformCjs(`"use client";\nconst x = require("./x");\nexport default x;`);
  assert.match(out, /^"use client";\nimport \* as __vinext_req_0/);
});
