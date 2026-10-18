// Incremental Static Regeneration for getStaticProps pages that return
// `revalidate`: an in-memory cache answering MISS (rendered now), HIT
// (fresh) or STALE (served old while one background render replaces it).

const YEAR = 31536000;

/** Next.js's Cache-Control for a revalidating page (default expireTime a year). */
export function isrCacheControl(revalidate) {
  return `s-maxage=${revalidate}, stale-while-revalidate=${YEAR - revalidate}`;
}

const cacheable = (entry) => entry && typeof entry.revalidate === "number" && entry.revalidate > 0;

export function createIsrCache({ now = Date.now } = {}) {
  const entries = new Map();
  const pending = new Map();

  function store(key, entry) {
    if (cacheable(entry)) entries.set(key, { entry, at: now() });
    else entries.delete(key);
  }

  function regenerate(key, render) {
    if (pending.has(key)) return;
    const job = Promise.resolve()
      .then(render)
      .then(
        (entry) => store(key, entry),
        (err) => console.error(`[vinext] ISR regeneration of ${key} failed:`, err),
      )
      .finally(() => pending.delete(key));
    pending.set(key, job);
  }

  return {
    /**
     * The entry for key with its cache state ("MISS" | "HIT" | "STALE"),
     * or state null when render's result does not revalidate.
     */
    async get(key, render) {
      const hit = entries.get(key);
      if (hit) {
        if (now() - hit.at < hit.entry.revalidate * 1000) return { state: "HIT", entry: hit.entry };
        regenerate(key, render);
        return { state: "STALE", entry: hit.entry };
      }
      const entry = await render();
      store(key, entry);
      return { state: cacheable(entry) ? "MISS" : null, entry };
    },
    /** Resolves when background regenerations finish (for tests). */
    async settled() {
      await Promise.all([...pending.values()]);
    },
    clear() {
      entries.clear();
    },
  };
}
