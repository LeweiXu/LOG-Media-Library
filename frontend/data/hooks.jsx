import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getEntries, getEntryCounts, getCustomLists, getStats,
  updateEntry, createEntry, deleteEntry, batchUpdateEntries, batchDeleteEntries,
  fetchCoverBundle,
} from '../api.jsx';
import { extractItems } from '../utils.jsx';
import { entriesKey, countsKey, listsKey, statsKey, coverBundleKey } from './keys.js';

const EMPTY_MAP = {};

// Normalize /entries into the shape pages consume: { items, total, limit, offset }.
export function fetchEntriesPayload(params) {
  return getEntries(params).then(data => {
    const items = extractItems(data);
    return {
      items,
      total: data?.total ?? items.length,
      limit: data?.limit ?? params.limit,
      offset: data?.offset ?? params.offset,
    };
  });
}

function fetchLists() {
  return getCustomLists().then(data => (Array.isArray(data) ? data : []));
}

// ── Reads ──────────────────────────────────────────────────────────────────

export function useEntries(params, options = {}) {
  return useQuery({
    queryKey: entriesKey(params),
    queryFn: () => fetchEntriesPayload(params),
    ...options,
  });
}

export function useEntryCounts(options = {}) {
  return useQuery({ queryKey: countsKey(), queryFn: getEntryCounts, ...options });
}

export function useCustomLists(options = {}) {
  return useQuery({ queryKey: listsKey(), queryFn: fetchLists, ...options });
}

export function useStats(options = {}) {
  return useQuery({ queryKey: statsKey(), queryFn: getStats, ...options });
}

// ── Cover bundles (all of a view's covers at one size, in one request) ────────

function bundleQuery(size, urls) {
  const unique = [...new Set(urls.filter(Boolean))];
  return {
    queryKey: coverBundleKey(size, unique),
    queryFn: () => fetchCoverBundle(unique, size).then(r => r?.images || {}),
    enabled: unique.length > 0,
    // Covers are immutable per URL — keep them around and never auto-refetch.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    // Some covers may still be caching server-side (e.g. just-rerolled Explore
    // recommendations, cached in the background). Poll a few times while the
    // bundle is incomplete, then give up — anything still missing is uncached
    // (Cloudflare/NU) and stays a placeholder until the extension uploads it.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (Object.keys(data).length >= unique.length) return false;
      if (query.state.dataUpdateCount > 6) return false;
      return 2500;
    },
  };
}

/** Returns a `{ coverUrl: dataURI }` map for the given URLs at `size`. */
export function useCoverBundle(urls, size) {
  const query = useQuery(bundleQuery(size, urls));
  return query.data || EMPTY_MAP;
}

export function prefetchCoverBundle(qc, urls, size) {
  const q = bundleQuery(size, urls);
  if (q.enabled) qc.prefetchQuery(q);
}

// Prefetch an entries page AND its covers, so a hover warms the rows and their
// images together. fetchQuery resolves the page so we know which covers to bundle.
export function prefetchEntriesWithCovers(qc, params, size = 'thumb') {
  qc.fetchQuery({ queryKey: entriesKey(params), queryFn: () => fetchEntriesPayload(params) })
    .then(data => prefetchCoverBundle(qc, (data?.items || []).map(e => e.cover_url), size))
    .catch(() => {});
}

// ── Prefetch (hover preloading) ──────────────────────────────────────────────
// Fire-and-forget; React Query swallows failures, so a missed prefetch just means
// the click fetches normally.

export function prefetchEntries(qc, params) {
  qc.prefetchQuery({ queryKey: entriesKey(params), queryFn: () => fetchEntriesPayload(params) });
}
export function prefetchCounts(qc) {
  qc.prefetchQuery({ queryKey: countsKey(), queryFn: getEntryCounts });
}
export function prefetchLists(qc) {
  qc.prefetchQuery({ queryKey: listsKey(), queryFn: fetchLists });
}
export function prefetchStats(qc) {
  qc.prefetchQuery({ queryKey: statsKey(), queryFn: getStats });
}

// ── The shared mutation contract ─────────────────────────────────────────────
// Every entry mutation: optimistically patch the row in all cached entries
// queries (instant feedback), roll back on error, and on settle invalidate
// entries/counts/lists/stats. Invalidation refetches the *active* view with its
// current sort/filter params, so the row moves / drops out correctly — that is
// the whole fix for "an edit doesn't reorder or disappear under a sort/filter".

function patchEntryEverywhere(qc, id, patch) {
  qc.setQueriesData({ queryKey: ['entries'] }, old => {
    if (!old?.items || !old.items.some(e => e.id === id)) return old;
    return { ...old, items: old.items.map(e => (e.id === id ? { ...e, ...patch } : e)) };
  });
}

function removeEntryEverywhere(qc, id) {
  qc.setQueriesData({ queryKey: ['entries'] }, old => {
    if (!old?.items || !old.items.some(e => e.id === id)) return old;
    return {
      ...old,
      items: old.items.filter(e => e.id !== id),
      total: Math.max(0, (old.total ?? old.items.length) - 1),
    };
  });
}

function restoreSnapshot(qc, snapshot) {
  snapshot?.forEach(([key, data]) => qc.setQueryData(key, data));
}

export function invalidateEntryData(qc) {
  qc.invalidateQueries({ queryKey: ['entries'] });
  qc.invalidateQueries({ queryKey: ['entryCounts'] });
  qc.invalidateQueries({ queryKey: ['customLists'] });
  qc.invalidateQueries({ queryKey: ['stats'] });
}

// For the modal edit/delete path: EntryFormModal still writes through the API
// itself, then calls back with the saved entry / deleted id. These sync the cache
// the same way the mutations do (optimistic patch/remove, then invalidate) so the
// current view reconciles under any active sort/filter.
export function syncUpdatedEntry(qc, updated) {
  if (updated) patchEntryEverywhere(qc, updated.id, updated);
  invalidateEntryData(qc);
}
export function syncDeletedEntry(qc, id) {
  removeEntryEverywhere(qc, id);
  invalidateEntryData(qc);
}

export function useEntryMutations() {
  const qc = useQueryClient();

  const update = useMutation({
    mutationFn: ({ id, patch }) => updateEntry(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['entries'] });
      const snapshot = qc.getQueriesData({ queryKey: ['entries'] });
      patchEntryEverywhere(qc, id, patch);
      return { snapshot };
    },
    onError: (_e, _v, ctx) => restoreSnapshot(qc, ctx?.snapshot),
    onSuccess: (updated, { id }) => { if (updated) patchEntryEverywhere(qc, id, updated); },
    onSettled: () => invalidateEntryData(qc),
  });

  const create = useMutation({
    mutationFn: (data) => createEntry(data),
    onSettled: () => invalidateEntryData(qc),
  });

  const remove = useMutation({
    mutationFn: (id) => deleteEntry(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['entries'] });
      const snapshot = qc.getQueriesData({ queryKey: ['entries'] });
      removeEntryEverywhere(qc, id);
      return { snapshot };
    },
    onError: (_e, _v, ctx) => restoreSnapshot(qc, ctx?.snapshot),
    onSettled: () => invalidateEntryData(qc),
  });

  const batchUpdate = useMutation({
    mutationFn: ({ ids, patch }) => batchUpdateEntries(ids, patch),
    onSettled: () => invalidateEntryData(qc),
  });

  const batchDelete = useMutation({
    mutationFn: (ids) => batchDeleteEntries(ids),
    onSettled: () => invalidateEntryData(qc),
  });

  return { update, create, remove, batchUpdate, batchDelete };
}
