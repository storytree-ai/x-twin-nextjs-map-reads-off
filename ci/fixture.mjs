#!/usr/bin/env node
// Copy a fixture app to a scratch dir and point it at the packed vinext,
// the way run_tests.py's swap_to_solution does, so ci/checks.sh can smoke
// test without python or a pre-warmed npm cache.
//
// Usage: node ci/fixture.mjs <app-name> <vinext.tgz> <dest-dir>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [appName, tgz, dest] = process.argv.slice(2);
if (!appName || !tgz || !dest) {
  console.error("usage: node ci/fixture.mjs <app-name> <vinext.tgz> <dest-dir>");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "apps", appName);
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true, filter: (p) => !p.includes(`${path.sep}node_modules`) });

const pkgPath = path.join(dest, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
for (const key of ["dependencies", "devDependencies"]) {
  const deps = pkg[key];
  if (!deps) continue;
  delete deps.next;
  delete deps.vinext;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === "string" && (spec.startsWith("workspace:") || spec.startsWith("catalog:"))) {
      delete deps[name];
    }
  }
}
pkg.dependencies = {
  ...pkg.dependencies,
  vinext: `file:${path.resolve(tgz)}`,
  vite: "8.0.2",
  "@vitejs/plugin-react": "6.0.1",
  "@vitejs/plugin-rsc": "0.5.19",
  react: "19.2.4",
  "react-dom": "19.2.4",
  "react-server-dom-webpack": "19.2.4",
};
pkg.scripts = { ...pkg.scripts, dev: "vinext dev", build: "vinext build", start: "vinext start" };
pkg.type = "module";
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

for (const file of ["next.config.js", "eslintrc.js"]) {
  const p = path.join(dest, file);
  if (fs.existsSync(p)) fs.renameSync(p, p.slice(0, -3) + ".cjs");
}

fs.writeFileSync(
  path.join(dest, "vite.config.ts"),
  `import { defineConfig } from "vite";
import vinext from "vinext";

export default defineConfig({
  plugins: [vinext()],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
});
`,
);
