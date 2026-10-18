// Project layout: where the Pages Router and App Router directories live.
import fs from "node:fs";
import path from "node:path";

function dirIfExists(...parts) {
  const p = path.join(...parts);
  try {
    return fs.statSync(p).isDirectory() ? p : null;
  } catch {
    return null;
  }
}

export function detectRouters(root) {
  return {
    pagesDir: dirIfExists(root, "pages") || dirIfExists(root, "src", "pages"),
    appDir: dirIfExists(root, "app") || dirIfExists(root, "src", "app"),
  };
}
