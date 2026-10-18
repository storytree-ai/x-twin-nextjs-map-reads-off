// The App Router's SSR entry (ssr environment): the RSC stream becomes a
// React tree again and renders to an HTML stream, with the RSC payload
// inlined as <script> chunks the browser entry hydrates from.
import { createElement as h, use } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { createFromReadableStream } from "@vitejs/plugin-rsc/ssr";
import { AppNavContext } from "../shims/app-nav-context.js";
import { injectFlight } from "./flight-inline.js";

const serverRouter = {
  push() {},
  replace() {},
  back() {},
  forward() {},
  refresh() {},
  prefetch() {},
};

export async function renderHtml(rscStream, nav) {
  const [forRender, forInline] = rscStream.tee();
  const payload = createFromReadableStream(forRender);
  const value = {
    pathname: nav.pathname,
    search: nav.search,
    params: nav.params,
    router: serverRouter,
  };
  function Root() {
    return h(AppNavContext.Provider, { value }, use(payload).tree);
  }
  const bootstrapScriptContent = await import.meta.viteRsc.loadBootstrapScriptContent("index");
  const html = await renderToReadableStream(h(Root), {
    bootstrapScriptContent,
    formState: nav.formState || null,
    onError(err) {
      if (err && typeof err === "object" && typeof err.digest === "string") return err.digest;
      console.error(err);
    },
  });
  return html.pipeThrough(injectFlight(forInline));
}
