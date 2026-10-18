// The RSC payload inlined into the HTML stream: each flight chunk becomes
// <script>(self.__vinext_f||=[]).push("…")</script>, which the browser
// entry reads back as a stream (readInlineFlight). Scripts go in after an
// HTML flush has finished (React writes one flush in several chunks in the
// same tick, possibly split mid-tag) and before the closing </body></html>.

/** One flight chunk as an inline script. */
export function flightScript(chunk) {
  const json = JSON.stringify(chunk)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<script>(self.__vinext_f||=[]).push(${json})</script>`;
}

/** A TransformStream over the HTML stream that interleaves rscStream's chunks. */
export function injectFlight(rscStream) {
  const encoder = new TextEncoder();
  const htmlDecoder = new TextDecoder();
  const rscDecoder = new TextDecoder();
  let pending = "";
  let tail = null; // "</body></html>" and anything after it, held to the end
  let controller = null;
  let timer = null;
  let closed = false;

  const flushPending = () => {
    timer = null;
    if (pending && controller && !closed) {
      controller.enqueue(encoder.encode(pending));
      pending = "";
    }
  };
  const schedule = () => {
    if (!timer && controller) timer = setTimeout(flushPending, 0);
  };

  const rscDone = (async () => {
    const reader = rscStream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = rscDecoder.decode(value, { stream: true });
      if (text) pending += flightScript(text);
      schedule();
    }
    const rest = rscDecoder.decode();
    if (rest) pending += flightScript(rest);
  })();

  return new TransformStream({
    start(c) {
      controller = c;
    },
    transform(chunk, c) {
      let text = htmlDecoder.decode(chunk, { stream: true });
      if (tail !== null) {
        tail += text;
        return;
      }
      const end = text.indexOf("</body>");
      if (end !== -1) {
        tail = text.slice(end);
        text = text.slice(0, end);
      }
      if (text) c.enqueue(encoder.encode(text));
      schedule();
    },
    async flush(c) {
      await rscDone;
      if (timer) clearTimeout(timer);
      const rest = htmlDecoder.decode();
      if (tail !== null) tail += rest;
      else pending = rest + pending;
      c.enqueue(encoder.encode(pending + (tail ?? "")));
      closed = true;
    },
  });
}
