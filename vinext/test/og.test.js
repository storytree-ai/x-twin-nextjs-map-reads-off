import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { ImageResponse } from "../src/shims/og.js";

const el = (type, props = {}, ...children) => ({
  $$typeof: Symbol.for("react.transitional.element"),
  type,
  key: null,
  props: children.length ? { ...props, children: children.length === 1 ? children[0] : children } : props,
});

/** { width, height, pixel(x, y) -> [r, g, b, a] } of an 8-bit RGBA, filter-0 PNG. */
function decodePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let pos = 8;
  let width, height;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "bit depth");
      assert.equal(data[9], 6, "RGBA");
    }
    if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  assert.equal(raw.length, stride * height);
  return {
    width,
    height,
    pixel(x, y) {
      assert.equal(raw[y * stride], 0, "filter type");
      const o = y * stride + 1 + x * 4;
      return [...raw.subarray(o, o + 4)];
    },
  };
}

async function render(element, options) {
  const res = new ImageResponse(element, options);
  return { res, png: decodePng(Buffer.from(await res.arrayBuffer())) };
}

const near = (actual, expected, tolerance = 3) =>
  assert.ok(
    actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance),
    `${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`,
  );

test("ImageResponse answers a PNG Response of the asked size", async () => {
  const { res, png } = await render(el("div", { style: { width: "100%", height: "100%", display: "flex" } }), { width: 1200, height: 630 });
  assert.ok(res instanceof Response);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(png.width, 1200);
  assert.equal(png.height, 630);
  near(png.pixel(10, 10), [0, 0, 0, 0]);
});

test("ImageResponse defaults to 1200x630 and keeps status and headers", async () => {
  const { res, png } = await render(el("div", {}), { status: 201, headers: { "x-og": "yes" } });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get("x-og"), "yes");
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(png.width, 1200);
  assert.equal(png.height, 630);
});

test("a background colour fills the element's box", async () => {
  const box = el("div", { style: { display: "flex", width: "100%", height: "100%", padding: 10 } },
    el("div", { style: { width: 20, height: 10, backgroundColor: "#0070f3" } }));
  const { png } = await render(box, { width: 64, height: 32 });
  near(png.pixel(15, 15), [0, 0x70, 0xf3, 255]);
  near(png.pixel(5, 5), [0, 0, 0, 0]);
  near(png.pixel(35, 15), [0, 0, 0, 0]);
});

test("a linear-gradient runs from its first stop to its last along its angle", async () => {
  const { png } = await render(
    el("div", { style: { width: "100%", height: "100%", background: "linear-gradient(90deg, #ff0000 0%, #0000ff 100%)" } }),
    { width: 100, height: 10 },
  );
  near(png.pixel(0, 5), [255, 0, 0, 255], 8);
  near(png.pixel(99, 5), [0, 0, 255, 255], 8);
  const mid = png.pixel(50, 5);
  assert.ok(mid[0] > 90 && mid[0] < 165 && mid[2] > 90 && mid[2] < 165, `midpoint ${mid}`);
});

test("borderRadius 50% rounds the box into a circle", async () => {
  const { png } = await render(
    el("div", { style: { width: "100%", height: "100%", backgroundColor: "white", borderRadius: "50%" } }),
    { width: 32, height: 32 },
  );
  near(png.pixel(16, 16), [255, 255, 255, 255]);
  assert.equal(png.pixel(0, 0)[3], 0);
  assert.equal(png.pixel(31, 31)[3], 0);
});

test("centred text is drawn in its colour in the middle of the box", async () => {
  const { png } = await render(
    el("div", { style: { display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "black" } },
      el("span", { style: { fontSize: 24, color: "white" } }, "N")),
    { width: 64, height: 64 },
  );
  const lit = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (png.pixel(x, y)[0] > 200) lit.push([x, y]);
  assert.ok(lit.length > 20, `only ${lit.length} text pixels`);
  for (const [x, y] of lit) assert.ok(x > 16 && x < 48 && y > 16 && y < 48, `text pixel at ${x},${y} is off centre`);
});

test("function components and fragments render through", async () => {
  const Red = ({ size }) => el("div", { style: { width: size, height: size, backgroundColor: "rgb(255, 0, 0)" } });
  const { png } = await render(el(Symbol.for("react.fragment"), {}, el(Red, { size: 8 })), { width: 16, height: 16 });
  near(png.pixel(4, 4), [255, 0, 0, 255]);
  near(png.pixel(12, 12), [0, 0, 0, 0]);
});
