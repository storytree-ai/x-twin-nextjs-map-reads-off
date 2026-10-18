import { test } from "node:test";
import assert from "node:assert/strict";
import { injectFlight, flightScript } from "../src/app/flight-inline.js";

const enc = new TextEncoder();

function streamOf(chunks) {
  return new ReadableStream({
    start(c) {
      for (const x of chunks) c.enqueue(enc.encode(x));
      c.close();
    },
  });
}

async function text(stream) {
  return new Response(stream).text();
}

test("flight chunks land as scripts before </body></html>, never inside an HTML flush", async () => {
  // One synchronous flush split mid-tag, as React's 2KB buffer may do.
  const html = streamOf(["<!DOCTYPE html><html><head></head><body><di", "v>hi</div></body></html>"]);
  const out = await text(html.pipeThrough(injectFlight(streamOf(['0:{"a":1}\n', "1:</script>\n"]))));
  assert.ok(out.includes("<div>hi</div>"), out);
  assert.ok(out.endsWith("</body></html>"), out);
  assert.ok(out.indexOf("<script>") > out.indexOf("<div>hi</div>"), out);
  // The payload's own "</script>" must not close a script early.
  assert.equal(out.split("<script>").length, out.split("</script>").length, out);
});

test("a flight script escapes HTML-significant characters", () => {
  const s = flightScript('x</script><!--\u2028');
  assert.equal(s.match(/<\/script>/g).length, 1);
  assert.ok(!s.includes("<!--"));
  assert.ok(!s.includes("\u2028"));
});
