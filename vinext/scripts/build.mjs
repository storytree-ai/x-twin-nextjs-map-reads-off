// The production build: vinext ships its plain-ESM sources as dist/, so the
// build needs no dependencies (the verifier installs --offline). Each module
// is syntax-checked on the way.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const src = path.resolve("src");
const dist = path.resolve("dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(src, dist, { recursive: true });

const files = fs
  .readdirSync(dist, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".js"));
for (const f of files) {
  const check = spawnSync(process.execPath, ["--check", path.join(dist, f)], { stdio: "inherit" });
  if (check.status !== 0) process.exit(check.status ?? 1);
}
fs.chmodSync(path.join(dist, "cli.js"), 0o755);
console.log(`vinext: built ${files.length} modules into dist/`);
