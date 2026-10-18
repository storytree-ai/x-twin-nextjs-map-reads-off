// Route segment config for app pages (revalidate, dynamic, dynamicParams
// exported by layouts and the page) and the Cache-Control it gives the
// response, as `next dev` answers it.

const NO_STORE = "private, no-cache, no-store, max-age=0, must-revalidate";

/** The config of a chain of segment modules (layouts root first, then the page). */
export function segmentConfig(mods) {
  let revalidate;
  let dynamic;
  let dynamicParams = true;
  for (const mod of mods) {
    if (!mod) continue;
    if (typeof mod.revalidate === "number" || mod.revalidate === false) {
      const r = mod.revalidate === false ? Infinity : mod.revalidate;
      revalidate = revalidate === undefined ? r : Math.min(revalidate, r);
    }
    if (mod.dynamic && dynamic !== "force-dynamic") dynamic = mod.dynamic;
    if (mod.dynamicParams === false) dynamicParams = false;
  }
  return { revalidate, dynamic, dynamicParams };
}

/** The Cache-Control for a page response, or null for none. */
export function pageCacheControl(config, { status, dynamicUsed = false }) {
  if (status !== 200) return NO_STORE;
  if (config.dynamic === "force-dynamic" || dynamicUsed || config.revalidate === 0) return NO_STORE;
  if (typeof config.revalidate === "number" && config.revalidate > 0 && config.revalidate !== Infinity) {
    return `s-maxage=${config.revalidate}, stale-while-revalidate`;
  }
  return null;
}

const same = (a, b) => (Array.isArray(a) || Array.isArray(b) ? [].concat(a).join("/") === [].concat(b).join("/") : String(a) === String(b));

/** Whether params is one of generateStaticParams' entries (on the entry's own keys). */
export function inStaticParams(list, params) {
  return (list || []).some((entry) => Object.entries(entry).every(([k, v]) => params[k] !== undefined && same(v, params[k])));
}
