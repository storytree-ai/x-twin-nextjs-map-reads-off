// `vinext dev`: a Vite dev server over the app's vite.config (whose
// plugins include vinext()), on the requested port.
export async function dev({ root, port = 3000, host }) {
  const { createServer } = await import("vite");
  const server = await createServer({
    root,
    mode: "development",
    server: { port, strictPort: true, ...(host ? { host } : {}) },
  });
  await server.listen();
  server.printUrls();
  const shutdown = () => {
    server.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}
