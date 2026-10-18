// Run every test/**/*.test.js with node:test (explicit file list, so it
// works on Node versions with and without --test glob support).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const files = fs
  .readdirSync("test", { recursive: true })
  .filter((f) => String(f).endsWith(".test.js"))
  .map((f) => path.join("test", String(f)));
const run = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(run.status ?? 1);
