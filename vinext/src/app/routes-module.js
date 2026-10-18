// virtual:vinext/app-routes: the app/ route table as a module for the RSC
// entry, each convention file a lazy import() so only the matched route's
// modules load.
import { scanAppDir, scanMetadataFiles } from "../routing/app-routes.js";

export const APP_ROUTES_ID = "virtual:vinext/app-routes";
export const RESOLVED_APP_ROUTES_ID = "\0" + APP_ROUTES_ID;

const LEVEL_KEYS = ["layout", "template", "notFound", "error", "loading", "globalError", "forbidden", "unauthorized"];

const lazy = (file) => (file ? `() => import(${JSON.stringify(file)})` : "null");

function levelCode(level) {
  const files = LEVEL_KEYS.map((k) => `${k}: ${lazy(level[k])}`).join(", ");
  return `{ paramNames: ${JSON.stringify(level.paramNames)}, ${files} }`;
}

export function generateAppRoutesModule(appDir) {
  const { routes, root } = scanAppDir(appDir);
  const routeCode = routes.map(
    (r) =>
      `  { pattern: ${JSON.stringify(r.pattern)}, kind: ${JSON.stringify(r.kind)}, ` +
      `segments: ${JSON.stringify(r.segments)}, module: ${lazy(r.file)}, ` +
      `levels: [${r.levels.map(levelCode).join(", ")}] }`,
  );
  const rootCode = root ? levelCode(root) : "{ paramNames: [] }";
  const meta = scanMetadataFiles(appDir);
  const metaRoutes = meta.routes.map((r) => `  { path: ${JSON.stringify(r.path)}, type: ${JSON.stringify(r.type)}, module: ${lazy(r.file)} }`);
  return (
    `export const routes = [\n${routeCode.join(",\n")}\n];\nexport const rootLevel = ${rootCode};\n` +
    `export const fileIcons = ${JSON.stringify(meta.icons)};\n` +
    `export const metadataRoutes = [\n${metaRoutes.join(",\n")}\n];\n`
  );
}
