// Query-key factories + shared param helpers. Keeping keys in one place means
// every reader (a page's useQuery) and every prefetch (nav hover) hash to the
// same cache bucket. React Query hashes keys deterministically, so object-key
// order inside the params doesn't matter — same content is the same query.

export const entriesKey = (params = {}) => ['entries', params];
export const countsKey  = () => ['entryCounts'];
export const listsKey   = () => ['customLists'];
export const statsKey   = () => ['stats'];
export const dashboardBootstrapKey = () => ['dashboardBootstrap'];

// Keyed by the (sorted, de-duped) cover-URL set + size, NOT by entry params, so
// the bundle stays cached across entry edits (covers are immutable per URL) and
// isn't re-sent on every optimistic patch + invalidation.
export const coverBundleKey = (size, urls) =>
  ['coverBundle', size, [...new Set(urls)].sort()];

// The exact params Library fetches on a fresh mount (no filters, page 1). Nav-hover
// prefetch uses this so its key matches Library's first query and the click serves
// a warm cache. Mirrors buildEntryParams() in Library.jsx for that case — keep the
// defaults here in sync with DEFAULT_SORT / DEFAULT_ORDER / DEFAULT_LIMIT there.
export function defaultLibraryParams(prefs) {
  const lib = prefs?.library || {};
  return {
    sort: lib.default_sort || 'completed_at',
    order: 'desc',
    limit: lib.entries_per_page || 40,
    offset: 0,
  };
}
