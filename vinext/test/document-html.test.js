import { test } from "node:test";
import assert from "node:assert/strict";
import { fillDocument } from "../src/server/document-html.js";

const markup =
  '<html><head><meta charSet="utf-8"/><vinext-marker data-marker="head"></vinext-marker></head>' +
  '<body><vinext-marker data-marker="main"></vinext-marker><vinext-marker data-marker="scripts"></vinext-marker></body></html>';

test("document markers are replaced by head, page and scripts", () => {
  const html = fillDocument(markup, { head: "<title>t</title>", main: "<h1>hi</h1>", scripts: "<script></script>" });
  assert.equal(
    html,
    '<html><head><meta charSet="utf-8"/><title>t</title></head><body><div id="__next"><h1>hi</h1></div><script></script></body></html>',
  );
});

test("dollar sequences in page content are kept verbatim", () => {
  const main = "Price: $$5 and $& and $' and $`";
  const html = fillDocument(markup, { head: "$&", main, scripts: "$$" });
  assert.ok(html.includes(`<div id="__next">${main}</div>`));
  assert.ok(html.includes("<head><meta charSet=\"utf-8\"/>$&</head>"));
  assert.ok(html.includes("</div>$$</body>"));
});
