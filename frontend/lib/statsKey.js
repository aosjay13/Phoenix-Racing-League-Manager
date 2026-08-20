// The cache key for one expensive read, in a module of its own.
//
// It lives here rather than beside the cache because the aggregate STORE needs
// it too — to derive a stable document id — and the store is imported BY the
// cache. Leaving the key in lib/statsCache.js would make those two modules
// import each other.

// The cache key for one read. Sorted, so two callers that build the same query
// with their keys in a different order share an entry rather than each paying
// for their own; JSON-encoded as pairs, so no combination of values can be
// spelled two ways or collide with another (a param holding "a|b" is not the
// same key as two params "a" and "b").
export function cacheKeyFor(name, leagueId, params = {}) {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return [name, leagueId || "", JSON.stringify(pairs)];
}
