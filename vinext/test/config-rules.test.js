import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRules, collectHeaders, findRedirect, findRewrite } from "../src/server/config-rules.js";

const config = {
  async redirects() {
    return [
      { source: "/old-about", destination: "/about", permanent: true },
      { source: "/repeat-redirect/:id", destination: "/docs/:id/:id", permanent: false },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/mw-gated-before", has: [{ type: "cookie", key: "mw-before-user" }], destination: "/about" }],
      afterFiles: [{ source: "/after-rewrite", destination: "/about?from=after" }],
      fallback: [{ source: "/fallback-rewrite", destination: "/about" }],
    };
  },
  async headers() {
    return [
      { source: "/api/(.*)", headers: [{ key: "X-Custom-Header", value: "vinext" }] },
      { source: "/about", missing: [{ type: "cookie", key: "logged-in" }], headers: [{ key: "X-Guest-Only-Header", value: "1" }] },
    ];
  },
};

const req = (headers = {}, query = {}) => ({ headers, query });

test("redirects answer 308 for permanent, 307 otherwise, keeping the query", async () => {
  const rules = await loadRules(config);
  assert.deepEqual(findRedirect(rules.redirects, "/old-about", "?x=1", req()), { location: "/about?x=1", status: 308 });
  assert.deepEqual(findRedirect(rules.redirects, "/repeat-redirect/9", "", req()), { location: "/docs/9/9", status: 307 });
  assert.equal(findRedirect(rules.redirects, "/about", "", req()), null);
});

test("rewrites come in beforeFiles/afterFiles/fallback and honour has", async () => {
  const rules = await loadRules(config);
  assert.equal(findRewrite(rules.rewrites.beforeFiles, "/mw-gated-before", req()), null);
  assert.equal(findRewrite(rules.rewrites.beforeFiles, "/mw-gated-before", req({ cookie: "mw-before-user=1" })).pathname, "/about");
  assert.deepEqual(findRewrite(rules.rewrites.afterFiles, "/after-rewrite", req()), { pathname: "/about", query: { from: "after" }, external: null });
  assert.equal(findRewrite(rules.rewrites.fallback, "/fallback-rewrite", req()).pathname, "/about");
});

test("an array of rewrites is afterFiles", async () => {
  const rules = await loadRules({ rewrites: async () => [{ source: "/a", destination: "/b" }] });
  assert.equal(rules.rewrites.afterFiles.length, 1);
  assert.equal(rules.rewrites.beforeFiles.length, 0);
});

test("headers collect from every matching rule", async () => {
  const rules = await loadRules(config);
  assert.deepEqual(collectHeaders(rules.headers, "/api/hello", req()), [{ key: "X-Custom-Header", value: "vinext" }]);
  assert.deepEqual(collectHeaders(rules.headers, "/about", req({ cookie: "logged-in=1" })), []);
  assert.equal(collectHeaders(rules.headers, "/about", req()).length, 1);
});
