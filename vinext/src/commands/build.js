// `vinext build`: production builds land in later increments; for now it
// validates the project and exits cleanly.
import { detectRouters } from "../config/project.js";

export async function build({ root }) {
  const { pagesDir, appDir } = detectRouters(root);
  console.log(
    `vinext build: found ${[pagesDir && "pages/", appDir && "app/"].filter(Boolean).join(" and ") || "no router directory"}; production build is not implemented yet.`,
  );
}
