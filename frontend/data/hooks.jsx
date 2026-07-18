import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getEntries, getEntryCounts, getCustomLists, getStats,
  updateEntry, createEntry, deleteEntry, batchUpdateEntries, batchDeleteEntries,
} from '../api.jsx';
import { extractItems } from '../utils.jsx';
import { entriesKey, countsKey, listsKey, statsKey } from './keys.js';

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
