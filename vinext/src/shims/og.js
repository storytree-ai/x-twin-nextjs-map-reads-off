// next/og: ImageResponse, a Response whose body is a PNG drawn from a React
// element (Next uses satori + resvg; vinext draws with its own small
// dependency-free renderer, see ../og/render.js).
import { renderToPixels } from "../og/render.js";
import { encodePng } from "../og/png.js";

export class ImageResponse extends Response {
  constructor(element, options = {}) {
    const width = Math.max(1, Math.round(options.width || 1200));
    const height = Math.max(1, Math.round(options.height || 630));
    const headers = new Headers(options.headers);
    if (!headers.has("content-type")) headers.set("content-type", "image/png");
    if (!headers.has("cache-control")) {
      headers.set(
        "cache-control",
        process.env.NODE_ENV === "development" ? "no-cache, no-store" : "public, immutable, no-transform, max-age=31536000",
      );
    }
    super(encodePng(width, height, renderToPixels(element, width, height)), {
      status: options.status || 200,
      statusText: options.statusText,
      headers,
    });
  }
}
