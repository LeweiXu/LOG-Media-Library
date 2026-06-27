import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getEntries, updateEntry, deleteEntry,
  getCustomLists, batchUpdateEntries, batchDeleteEntries,
} from '../api.jsx';
import { statusLabel, fmtDate, progressPercent, progressLabel, extractItems, MEDIUMS, STATUSES, ORIGINS, onCoverError, visibleMediumsFromPrefs } from '../utils.jsx';
import { useRevalidateOnFocus } from '../hooks.jsx';
import AddEntryModal from './components/AddEntryModal.jsx';
import EntryDetailModal from './components/EntryDetailModal.jsx';
import ListsModal from './components/ListsModal.jsx';
import InlineListSelect from './components/InlineListSelect.jsx';
import ListChips, { ALL_LISTS, UNLISTED_LIST } from './components/ListChips.jsx';
import { SkeletonLine, SkeletonTable } from './components/Skeletons.jsx';
import { usePreferences, DEFAULT_UI } from '../preferences.jsx';
import CustomSelect from './components/CustomSelect.jsx';

const SORT_FIELDS = [
  { key: 'title',        label: 'Title' },
  { key: 'medium',       label: 'Medium' },
  { key: 'rating',       label: 'Rating' },
  { key: 'status',       label: 'Status' },
  { key: 'year',         label: 'Year' },
  { key: 'updated_at',   label: 'Updated' },
  { key: 'completed_at', label: 'Completed' },
];

// Fields offered by the Manage-mode "bulk edit field" tool, with input kind.
const BULK_FIELDS = [
  { key: 'rating', label: 'Rating',  kind: 'number', min: 0, max: 10, step: 0.5 },
  { key: 'medium', label: 'Medium',  kind: 'medium' },
  { key: 'origin', label: 'Origin',  kind: 'origin' },
  { key: 'year',   label: 'Year',    kind: 'number', min: 1800, max: 2100 },
  { key: 'total',  label: 'Total',   kind: 'number', min: 0 },
];

const PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100];
const DEFAULT_SORT = 'updated_at';
const DEFAULT_ORDER = 'desc';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 40;

// Column registry shared by the view + manage tables. `sort` (when present) is
// the entry field a column header sorts by; columns without it get a plain <th>.
// Title is rendered separately and always pinned first; ordering of the rest is
// driven by the saved `columns.{view,manage}` preference (set in Settings).
const LIB_COLS = {
  medium:      { label: 'Medium',      cls: 'col-medium',      sort: 'medium' },
  year:        { label: 'Year',        cls: 'col-year',        sort: 'year' },
  progress:    { label: 'Progress',    cls: 'col-progress' },
  status:      { label: 'Status',      cls: 'col-status',      sort: 'status' },
  rating:      { label: 'Rating',      cls: 'col-rating',      sort: 'rating' },
  updated:     { label: 'Updated',     cls: 'col-updated',     sort: 'updated_at' },
  completed:   { label: 'Completed',   cls: 'col-completed',   sort: 'completed_at' },
  custom_list: { label: 'Custom List', cls: 'col-custom-list' },
};

function validParam(value, allowed, fallback = '') {
  return allowed.includes(value) ? value : fallback;
}

function positiveIntParam(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default function Library({ initialFilters = {} }) {
  const didMountRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const hasUrlParams = searchParams.toString() !== '';
  const sortKeys = SORT_FIELDS.map(f => f.key);
  const urlHadSortRef  = useRef(searchParams.has('sort'));
  const urlHadLimitRef = useRef(searchParams.has('limit'));
  const urlHadModeRef  = useRef(
    searchParams.has('mode') || (!hasUrlParams && (initialFilters.mode === 'view' || initialFilters.mode === 'manage')),
  );
  const [settingsApplied, setSettingsApplied] = useState(false);

  const { prefs, loaded: prefsLoaded, updateUi } = usePreferences();
  const libPrefs = prefs.library || DEFAULT_UI.library;
  const visibleMediums = useMemo(() => visibleMediumsFromPrefs(prefs), [prefs]);
  const visibleMediumSet = useMemo(() => new Set(visibleMediums), [visibleMediums]);

  // ── Mode: 'view' (everyday edit) | 'manage' (bulk). URL/nav > saved default. ──
  const initialMode = (() => {
    const fromUrl = searchParams.get('mode');
    if (fromUrl === 'view' || fromUrl === 'manage') return fromUrl;
    if (!hasUrlParams && (initialFilters.mode === 'view' || initialFilters.mode === 'manage')) return initialFilters.mode;
    return 'view';
  })();
  const [mode, setMode] = useState(initialMode);
  const isManage = mode === 'manage';
  function changeMode(next) {
    // In-page toggle only — the saved default lives in Settings, so switching
    // here is transient and resets to `default_mode` on the next visit.
    setMode(next);
    if (next !== 'manage') clearSelection();
  }

  const [entries,      setEntries]      = useState([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [counts,       setCounts]       = useState({});

  // ── Custom lists ──
  const [lists,         setLists]         = useState([]);
  const [unlistedCount, setUnlistedCount] = useState(0);
  const [loadingLists,  setLoadingLists]  = useState(true);
  const listNames = useMemo(() => lists.map(l => l.name), [lists]);
  const [listFilter, setListFilter] = useState(() =>
    searchParams.get('list') || (!hasUrlParams ? initialFilters.list : '') || ALL_LISTS);

  // ── View-mode editing ──
  const [showAdd,        setShowAdd]        = useState(false);
  const [detailEntry,    setDetailEntry]    = useState(null);
  const [startEditing,   setStartEditing]   = useState(false);
  const [confirmDeleteId,setConfirmDeleteId] = useState(null);
  const [editingProgress,setEditingProgress] = useState(null); // { id, value }
  const [editingRating,  setEditingRating]   = useState(null); // { id, value }
  const [saving,         setSaving]          = useState('');

  // ── Manage-mode: bulk selection + tools ──
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const lastSelectedId = useRef(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkListValue, setBulkListValue] = useState('');
  const [bulkStatusValue, setBulkStatusValue] = useState('');
  const [bulkField, setBulkField] = useState('');
  const [bulkFieldValue, setBulkFieldValue] = useState('');
  const [showLists, setShowLists] = useState(false);
  const [listModalTab, setListModalTab] = useState('add');
  const [lastEntryWarning, setLastEntryWarning] = useState(null);

  const [drawer, setDrawer] = useState('');
  // View toggles + per-mode columns come from the saved UI preferences.
  const [showActions, setShowActions] = useState(false);
  const [fixTitle, setFixTitle] = useState(true);
  const toggleQuickActions = () => setShowActions(prev => {
    const next = !prev;
    updateUi({ library: { quick_actions: next } });
    return next;
  });
  const toggleFixTitle = () => setFixTitle(prev => {
    const next = !prev;
    updateUi({ library: { fix_title: next } });
    return next;
  });
  // Apply saved preferences once they load (first time only); URL params win.
  const prefsSyncedRef = useRef(false);
  useEffect(() => {
    if (!prefsLoaded || prefsSyncedRef.current) return;
    prefsSyncedRef.current = true;
    setShowActions(!!libPrefs.quick_actions);
    setFixTitle(!!libPrefs.fix_title);
    if (!urlHadModeRef.current && (libPrefs.default_mode === 'view' || libPrefs.default_mode === 'manage')) {
      setMode(libPrefs.default_mode);
    }
    if (!urlHadSortRef.current && libPrefs.default_sort && sortKeys.includes(libPrefs.default_sort)) {
      setSort(libPrefs.default_sort);
    }
    if (!urlHadLimitRef.current && PAGE_SIZE_OPTIONS.includes(libPrefs.entries_per_page)) {
      setLimit(libPrefs.entries_per_page);
    }
    setSettingsApplied(true);
  }, [prefsLoaded, libPrefs]);

  // Ordered list of columns per mode (saved order, filtered to known columns).
  const viewCols   = (libPrefs.columns?.view   || DEFAULT_UI.library.columns.view).filter(c => LIB_COLS[c]);
  const manageCols = (libPrefs.columns?.manage || DEFAULT_UI.library.columns.manage).filter(c => LIB_COLS[c]);

  const [search,       setSearch]       = useState(() => searchParams.get('q') || (!hasUrlParams ? initialFilters.title : '') || '');
  const [statusFilter, setStatusFilter] = useState(() => validParam(searchParams.get('status'), STATUSES, !hasUrlParams ? initialFilters.status || '' : ''));
  const [mediumFilter, setMediumFilter] = useState(() => validParam(searchParams.get('medium'), MEDIUMS, !hasUrlParams ? initialFilters.medium || '' : ''));
  const [originFilter, setOriginFilter] = useState(() => validParam(searchParams.get('origin'), ORIGINS, !hasUrlParams ? initialFilters.origin || '' : ''));
  const [sort,         setSort]         = useState(() => validParam(searchParams.get('sort'), sortKeys, DEFAULT_SORT));
  const [order,        setOrder]        = useState(() => searchParams.get('order') === 'asc' ? 'asc' : DEFAULT_ORDER);
  const [page,         setPage]         = useState(() => positiveIntParam(searchParams.get('page'), DEFAULT_PAGE));
  const [limit,        setLimit]        = useState(() => validParam(Number(searchParams.get('limit')), PAGE_SIZE_OPTIONS, DEFAULT_LIMIT));

  const listParams = useCallback(() => (
    listFilter === UNLISTED_LIST ? { custom_list_empty: true }
      : listFilter ? { custom_list: listFilter }
      : {}
  ), [listFilter]);

  useEffect(() => {
    if (mediumFilter && !visibleMediumSet.has(mediumFilter)) setMediumFilter('');
  }, [mediumFilter, visibleMediumSet]);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); }
    try {
      const params = {
        ...(search       && { title:  search }),
        ...(statusFilter && { status: statusFilter }),
        ...(mediumFilter && { medium: mediumFilter }),
        ...(originFilter && { origin: originFilter }),
        ...listParams(),
        sort, order, limit, offset: (page - 1) * limit,
      };

      const data  = await getEntries(params);
      const items = extractItems(data);
      setEntries(items);
      setTotal(data?.total ?? items.length);

      // build sidebar counts on first unfiltered load (global, across all lists)
      if (page === 1 && !search) {
        const allData = await getEntries({ limit: 2000 }).catch(() => data);
        const all     = extractItems(allData);
        const c = { _total: all.length };
        all.forEach(e => {
          c[e.status] = (c[e.status] || 0) + 1;
          if (e.medium) c[e.medium] = (c[e.medium] || 0) + 1;
          if (ORIGINS.includes(e.origin)) c[e.origin] = (c[e.origin] || 0) + 1;
        });
        setCounts(c);
      }
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, statusFilter, mediumFilter, originFilter, listParams, sort, order, page, limit]);

  const loadLists = useCallback(async ({ silent = false } = {}) => {
    // `silent` skips the loading flag so a background refresh (e.g. on tab
    // refocus) updates the list chips in place without flashing the counts.
    if (!silent) setLoadingLists(true);
    let nextLists = [];
    try {
      const [listData, unlistedData] = await Promise.all([
        getCustomLists(),
        getEntries({ custom_list_empty: true, limit: 1 }),
      ]);
      nextLists = Array.isArray(listData) ? listData : [];
      setLists(nextLists);
      setUnlistedCount(unlistedData?.total ?? extractItems(unlistedData).length);
    } catch { /* lists are best-effort */ }
    finally { if (!silent) setLoadingLists(false); }
    return nextLists;
  }, []);

  // reset to page 1 when filters/sort/limit/list change
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    setPage(1);
  }, [search, statusFilter, mediumFilter, originFilter, listFilter, sort, order, limit]);

  useEffect(() => { loadLists(); }, [loadLists]);
  useEffect(() => { if (settingsApplied) load(); }, [load, settingsApplied]);

  // If the active list no longer exists (deleted/emptied elsewhere), fall back to All.
  useEffect(() => {
    if (loadingLists) return;
    if (listFilter && listFilter !== UNLISTED_LIST && !listNames.includes(listFilter)) {
      setListFilter(ALL_LISTS);
    }
  }, [loadingLists, listNames, listFilter]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (statusFilter) params.set('status', statusFilter);
    if (mediumFilter) params.set('medium', mediumFilter);
    if (originFilter) params.set('origin', originFilter);
    if (listFilter) params.set('list', listFilter);
    if (sort !== DEFAULT_SORT) params.set('sort', sort);
    if (order !== DEFAULT_ORDER) params.set('order', order);
    if (page !== DEFAULT_PAGE) params.set('page', String(page));
    if (limit !== DEFAULT_LIMIT) params.set('limit', String(limit));
    setSearchParams(params, { replace: true });
  }, [search, statusFilter, mediumFilter, originFilter, listFilter, sort, order, page, limit, setSearchParams]);

  function refreshView() {
    loadLists();
    load(true);
  }

  // Pick up entries added elsewhere (e.g. the extension) when the tab refocuses.
  // Fully silent — updates entries and list counts in place without flashing.
  useRevalidateOnFocus(() => { loadLists({ silent: true }); load(true); });

  function handleSort(field) {
    if (sort === field) setOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSort(field); setOrder('desc'); }
  }

  async function handleStatusChange(id, newStatus) {
    try {
      const updated = await updateEntry(id, { status: newStatus });
      setEntries(prev => {
        const mapped = prev.map(e => e.id === id ? { ...e, ...updated } : e);
        return (statusFilter && newStatus !== statusFilter)
          ? mapped.filter(e => e.id !== id)
          : mapped;
      });
      if (statusFilter && newStatus !== statusFilter) setTotal(t => t - 1);
    } catch (e) {
      alert('Update failed: ' + e.message);
    }
  }

  async function handleProgressSave(id, value) {
    setEditingProgress(null);
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      try {
        const updated = await updateEntry(id, { progress: num });
        setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updated } : e));
      } catch (e) { alert('Update failed: ' + e.message); }
    }
  }

  async function handleRatingSave(id, value) {
    setEditingRating(null);
    const num = value !== '' ? parseFloat(value) : null;
    if (num !== null && (isNaN(num) || num < 0 || num > 10)) return;
    try {
      const updated = await updateEntry(id, { rating: num ?? undefined });
      setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updated } : e));
    } catch (e) { alert('Update failed: ' + e.message); }
  }

  async function handleDeleteEntry(id) {
    try {
      await deleteEntry(id);
      setConfirmDeleteId(null);
      setEntries(prev => prev.filter(e => e.id !== id));
      setTotal(t => t - 1);
      refreshView();
    } catch (e) { alert('Delete failed: ' + e.message); }
  }

  const handleUpdated = (updated) => {
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
  };
  const handleDeleted = (id) => {
    setConfirmDeleteId(null);
    setDetailEntry(null);
    setEntries(prev => prev.filter(e => e.id !== id));
    setTotal(t => t - 1);
    refreshView();
  };

  // ── Custom-list assignment (manage-mode per-row column) ──
  function isRemovingLastEntryFromList(entry, nextValue) {
    const currentList = entry.custom_list || '';
    if (!currentList || currentList === nextValue) return false;
    return lists.find(l => l.name === currentList)?.count === 1;
  }

  async function saveEntryList(entry, nextValue, { skipWarning = false } = {}) {
    nextValue = nextValue || '';
    if (!skipWarning && isRemovingLastEntryFromList(entry, nextValue)) {
      setLastEntryWarning({ entry, nextValue });
      return;
    }
    setSaving(`entry:${entry.id}`);
    setLastEntryWarning(null);
    try {
      const updated = await updateEntry(entry.id, { custom_list: nextValue || null });
      await loadLists();
      const movedAway =
        listFilter === UNLISTED_LIST ? (nextValue || '') !== ''
          : listFilter ? nextValue !== listFilter
          : false;
      setEntries(prev => {
        const mapped = prev.map(e => e.id === entry.id ? { ...e, ...updated } : e);
        return movedAway ? mapped.filter(e => e.id !== entry.id) : mapped;
      });
      if (movedAway) setTotal(t => Math.max(0, t - 1));
    } catch (err) {
      alert('Update failed: ' + err.message);
    } finally {
      setSaving('');
    }
  }

  // ── Bulk selection ──
  const pageIds = useMemo(() => entries.map(e => e.id), [entries]);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));

  function toggleSelect(id, shiftKey = false) {
    setConfirmBulkDelete(false);
    setSelectedIds(prev => {
      const next = new Set(prev);
      const index = entries.findIndex(e => e.id === id);
      const anchorIndex = entries.findIndex(e => e.id === lastSelectedId.current);
      if (shiftKey && anchorIndex !== -1 && index !== -1) {
        const shouldSelect = !prev.has(id);
        const lo = Math.min(anchorIndex, index);
        const hi = Math.max(anchorIndex, index);
        for (let i = lo; i <= hi; i++) {
          const rangeId = entries[i]?.id;
          if (rangeId == null) continue;
          if (shouldSelect) next.add(rangeId); else next.delete(rangeId);
        }
      } else {
        next.has(id) ? next.delete(id) : next.add(id);
      }
      return next;
    });
    lastSelectedId.current = id;
  }

  function handleSelectClick(ev, id) {
    if (ev.shiftKey) ev.preventDefault();
    toggleSelect(id, ev.shiftKey);
  }

  function toggleSelectAll() {
    setConfirmBulkDelete(false);
    lastSelectedId.current = null;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    lastSelectedId.current = null;
    setConfirmBulkDelete(false);
    setBulkListValue('');
    setBulkStatusValue('');
    setBulkField('');
    setBulkFieldValue('');
    setBulkError('');
  }

  async function runBulk(patch) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkBusy(true); setBulkError('');
    try {
      await batchUpdateEntries(ids, patch);
      clearSelection();
      refreshView();
    } catch (err) { setBulkError(err.message); }
    finally { setBulkBusy(false); }
  }

  function bulkAssignList(value) {
    setBulkListValue(value); setBulkStatusValue(''); setBulkField(''); setBulkFieldValue('');
  }
  function bulkSetStatus(value) {
    setBulkStatusValue(value); setBulkListValue(''); setBulkField(''); setBulkFieldValue('');
  }
  function buildBulkPatch() {
    if (bulkListValue) return { custom_list: bulkListValue === '__none__' ? null : bulkListValue };
    if (bulkStatusValue) return { status: bulkStatusValue };
    if (!bulkField) return null;
    const meta = BULK_FIELDS.find(f => f.key === bulkField);
    if (!meta || bulkFieldValue === '') return null;
    let value = bulkFieldValue;
    if (meta.kind === 'number') value = value === '' ? null : Number(value);
    else value = value || null;
    return { [bulkField]: value };
  }
  function applyBulkChange() {
    const patch = buildBulkPatch();
    if (patch) runBulk(patch);
  }
  async function doBulkDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkBusy(true); setBulkError('');
    try {
      await batchDeleteEntries(ids);
      clearSelection();
      refreshView();
    } catch (err) { setBulkError(err.message); }
    finally { setBulkBusy(false); }
  }

  const clearFilters = () => { setSearch(''); setStatusFilter(''); setMediumFilter(''); setOriginFilter(''); };
  const hasFilters   = search || statusFilter || mediumFilter || originFilter;
  const totalPages   = Math.ceil(total / limit);

  const SortTh = ({ field, className, children }) => (
    <th className={`sortable${sort === field ? ' is-active' : ''}${className ? ' ' + className : ''}`}
      onClick={() => handleSort(field)}>
      {children}
      {sort === field && <span className="sort-indicator">{order === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );

  function openListsModal(tab = 'add') { setListModalTab(tab); setShowLists(true); }

  // At-a-glance figures for the right sidebar, derived from the global counts.
  const completionPct = counts._total ? Math.round((counts.completed || 0) / counts._total * 100) : 0;

  const mobileShow = ({
    title: 'status', medium: 'medium', rating: 'completed',
    status: 'status', year: 'year', updated_at: 'updated', completed_at: 'completed',
  })[sort] || 'status';
  const fixedTableClass = fixTitle ? ' is-fixed-title' : '';

  // ── Column rendering (order from saved prefs; Title pinned separately) ──
  function renderHead(col) {
    const meta = LIB_COLS[col];
    if (!meta) return null;
    return meta.sort
      ? <SortTh key={col} field={meta.sort} className={meta.cls}>{meta.label}</SortTh>
      : <th key={col} className={meta.cls}>{meta.label}</th>;
  }

  function listCell(entry) {
    return (
      <td key="custom_list" className="col-custom-list" onClick={ev => ev.stopPropagation()}>
        <InlineListSelect entry={entry} listNames={listNames}
          disabled={saving === `entry:${entry.id}`} onSave={saveEntryList} />
      </td>
    );
  }

  // Manage-mode cells: read-only fields (bulk editing happens via the side panel),
  // except the inline custom-list assigner.
  function renderManageCell(entry, col) {
    switch (col) {
      case 'status':    return <td key={col} className="col-status"><span className={`badge badge-${entry.status}`}>{statusLabel(entry.status)}</span></td>;
      case 'medium':    return <td key={col} className="col-medium"><span className="col-dim">{entry.medium || '—'}</span></td>;
      case 'year':      return <td key={col} className="col-year"><span className="col-dim">{entry.year || '—'}</span></td>;
      case 'rating':    return <td key={col} className="col-rating"><span className="rating-cell">{entry.rating != null ? entry.rating : '—'}<span>/10</span></span></td>;
      case 'progress':  return <td key={col} className="col-progress"><span className="col-dim">{progressLabel(entry)}</span></td>;
      case 'updated':   return <td key={col} className="col-updated"><span className="col-dim">{fmtDate(entry.updated_at)}</span></td>;
      case 'completed': return <td key={col} className="col-completed"><span className="col-dim">{fmtDate(entry.completed_at)}</span></td>;
      case 'custom_list': return listCell(entry);
      default: return null;
    }
  }

  // View-mode cells: status / progress / rating / custom-list are inline-editable.
  function renderViewCell(e, col) {
    switch (col) {
      case 'medium': return <td key={col} className="col-medium"><span className="col-dim">{e.medium}</span></td>;
      case 'year':   return <td key={col} className="col-year"><span className="col-dim">{e.year || '—'}</span></td>;
      case 'updated':   return <td key={col} className="col-updated"><span className="col-dim">{fmtDate(e.updated_at)}</span></td>;
      case 'completed': return <td key={col} className="col-completed"><span className="col-dim">{fmtDate(e.completed_at)}</span></td>;
      case 'progress': {
        const pct = progressPercent(e);
        const isEditingProg = editingProgress?.id === e.id;
        return (
          <td key={col} className="col-progress" onClick={ev => ev.stopPropagation()}>
            {isEditingProg ? (
              <input className="inline-select inline-number-sm" type="number" min="0"
                value={editingProgress.value} autoFocus
                onChange={ev => setEditingProgress({ id: e.id, value: ev.target.value })}
                onKeyDown={ev => {
                  if (ev.key === 'Enter') handleProgressSave(e.id, editingProgress.value);
                  if (ev.key === 'Escape') setEditingProgress(null);
                }}
                onBlur={() => handleProgressSave(e.id, editingProgress.value)} />
            ) : (
              <div className="progress-cell is-editable" title="Click to edit progress"
                onClick={() => setEditingProgress({ id: e.id, value: String(e.progress ?? '') })}>
                {progressLabel(e)}
                {pct > 0 && <div className="progress-mini"><div className="progress-mini-fill" style={{ '--progress-pct': `${pct}%` }} /></div>}
              </div>
            )}
          </td>
        );
      }
      case 'status': return (
        <td key={col} className="col-status" onClick={ev => ev.stopPropagation()}>
          <CustomSelect className="inline-select" value={e.status}
            options={STATUSES.map(status => ({ value: status, label: statusLabel(status) }))}
            onChange={value => handleStatusChange(e.id, value)}
            containerClassName="table-status-select"
            fitToOptions
            ariaLabel={`Status for ${e.title}`} />
        </td>
      );
      case 'rating': return (
        <td key={col} className="col-rating" onClick={ev => ev.stopPropagation()}>
          {editingRating?.id === e.id ? (
            <input className="inline-select inline-number-sm" type="number" min="0" max="10" step="0.5"
              value={editingRating.value} autoFocus
              onChange={ev => setEditingRating({ id: e.id, value: ev.target.value })}
              onKeyDown={ev => {
                if (ev.key === 'Enter') handleRatingSave(e.id, editingRating.value);
                if (ev.key === 'Escape') setEditingRating(null);
              }}
              onBlur={() => handleRatingSave(e.id, editingRating.value)} />
          ) : (
            <span className="rating-cell is-editable" title="Click to edit rating"
              onClick={() => setEditingRating({ id: e.id, value: String(e.rating ?? '') })}>
              {e.rating != null ? e.rating : '—'}<span>/10</span>
            </span>
          )}
        </td>
      );
      case 'custom_list': return listCell(e);
      default: return null;
    }
  }

  // ── Batch-edit panel (manage mode): right sidebar on desktop, inline on mobile ──
  const batchPanel = (
    <>
      <p className="panel-title">Batch Edit</p>
      <div className="batch-panel">
        <div className={`batch-hint${selectedIds.size ? ' is-active' : ''}`}>
          {selectedIds.size ? `${selectedIds.size} selected` : 'Select entries to edit in bulk'}
        </div>
        <CustomSelect
          className="inline-select batch-select"
          value={bulkListValue}
          options={[
            ...listNames.map(name => ({ value: name, label: name })),
            { value: '__none__', label: '— Remove from list —' },
          ]}
          onChange={bulkAssignList}
          placeholder="Assign to list…"
          disabled={bulkBusy || selectedIds.size === 0}
          ariaLabel="Assign selected entries to list"
        />
        <CustomSelect
          className="inline-select batch-select"
          value={bulkStatusValue}
          options={STATUSES.map(status => ({ value: status, label: statusLabel(status) }))}
          onChange={bulkSetStatus}
          placeholder="Set status…"
          disabled={bulkBusy || selectedIds.size === 0}
          ariaLabel="Set status for selected entries"
        />
        <CustomSelect
          className="inline-select batch-select"
          value={bulkField}
          options={BULK_FIELDS.map(field => ({ value: field.key, label: field.label }))}
          onChange={value => { setBulkField(value); setBulkFieldValue(''); setBulkListValue(''); setBulkStatusValue(''); }}
          placeholder="Edit field…"
          disabled={bulkBusy || selectedIds.size === 0}
          ariaLabel="Choose field to edit"
        />
        {bulkField && (
          <div className="batch-field-row">
            {(() => {
              const meta = BULK_FIELDS.find(f => f.key === bulkField);
              if (meta.kind === 'medium' || meta.kind === 'origin') {
                const opts = meta.kind === 'medium' ? visibleMediums : ORIGINS;
                return (
                  <CustomSelect
                    className="inline-select batch-select"
                    value={bulkFieldValue}
                    options={opts.map(option => ({ value: option, label: option }))}
                    onChange={setBulkFieldValue}
                    placeholder={`Choose ${meta.label.toLowerCase()}…`}
                    disabled={bulkBusy}
                    containerClassName="batch-field-control"
                    maxVisible={opts.length}
                    ariaLabel={`Choose ${meta.label.toLowerCase()}`}
                  />
                );
              }
              return (
                <input className="inline-select batch-select batch-field-input" type="number" placeholder={meta.label}
                  min={meta.min} max={meta.max} step={meta.step} value={bulkFieldValue} disabled={bulkBusy}
                  onChange={e => setBulkFieldValue(e.target.value)} />
              );
            })()}
          </div>
        )}
        <div className="batch-actions">
          <button className="icon-btn danger" disabled={bulkBusy || selectedIds.size === 0}
            onClick={() => confirmBulkDelete ? doBulkDelete() : setConfirmBulkDelete(true)}>
            {bulkBusy ? 'Working…' : confirmBulkDelete ? 'Confirm delete' : 'Delete'}
          </button>
          <button className="icon-btn accent" disabled={bulkBusy || selectedIds.size === 0 || !buildBulkPatch()} onClick={applyBulkChange}>
            Apply
          </button>
          <button className="icon-btn" disabled={bulkBusy} onClick={clearSelection}>Clear</button>
        </div>
        {bulkError && <div className="batch-error">{bulkError}</div>}
      </div>
    </>
  );

  const skeletonHeaders = isManage
    ? ['Sel', 'Title', 'Status', 'Medium', 'Rating', 'Progress', 'Updated', 'Custom List', ...(showActions ? ['Actions'] : [])]
    : ['Title', 'Medium', 'Year', 'Progress', 'Status', 'Rating', 'Updated', 'Completed', ...(showActions ? ['Actions'] : [])];

  return (
    <div className="layout-3col" data-drawer={drawer}>
      {drawer && <div className="drawer-backdrop" onClick={() => setDrawer('')} aria-hidden="true" />}

      {/* ── Left sidebar ── */}
      <div className="sidebar-left">
        <div className="sidebar-section">
          <span className="sidebar-label">Status</span>
          {[['', 'All'], ['current','Current'], ['planned','Planned'],
            ['completed','Completed'], ['on_hold','On Hold'], ['dropped','Dropped']
          ].map(([v, l]) => (
            <div key={v}
              className={`sidebar-item${statusFilter === v ? ' active' : ''}`}
              onClick={() => setStatusFilter(v)}>
              {l}
              {loading
                ? <SkeletonLine width={24} height={14} />
                : <span className="sidebar-count">{v === '' ? (counts._total || 0) : (counts[v] || 0)}</span>}
            </div>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="sidebar-label">Medium</span>
          <div className={`sidebar-item${mediumFilter === '' ? ' active' : ''}`} onClick={() => setMediumFilter('')}>All</div>
          {visibleMediums.map(m => (
            <div key={m} className={`sidebar-item${mediumFilter === m ? ' active' : ''}`} onClick={() => setMediumFilter(m)}>
              {m}
              {loading
                ? <SkeletonLine width={24} height={14} />
                : <span className="sidebar-count">{counts[m] || 0}</span>}
            </div>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="sidebar-label">Origin</span>
          <div className={`sidebar-item${originFilter === '' ? ' active' : ''}`} onClick={() => setOriginFilter('')}>All</div>
          {ORIGINS.map(o => (
            <div key={o} className={`sidebar-item${originFilter === o ? ' active' : ''}`} onClick={() => setOriginFilter(o)}>
              {o}
              {loading
                ? <SkeletonLine width={24} height={14} />
                : <span className="sidebar-count">{counts[o] || 0}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Main ── */}
      <div className="main-content">
        <div className="page-head">
          <div className="page-head-left">
            <button type="button" className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'left' ? '' : 'left')}
              aria-label="Toggle filters" title="Filters">☰ Filters</button>
            <span className="page-title">Library</span>
            <span className="page-desc">
              {loading ? <SkeletonLine width={74} height={11} /> : `${total} entries`}
            </span>
          </div>
          <div className="page-head-mobile">
            <button type="button" className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'right' ? '' : 'right')}
              aria-label="Toggle sort and tools" title="Sort & tools">⋯</button>
            {isManage
              ? <button className="btn" onClick={() => openListsModal('add')}>+ Add List</button>
              : <button className="btn" onClick={() => setShowAdd(true)}>+ Add Entry</button>}
          </div>
        </div>

        <div className="filter-bar">
          <input className="library-search-input" placeholder="Search titles…" value={search}
            onChange={e => setSearch(e.target.value)} />
          <CustomSelect
            value={sort}
            options={SORT_FIELDS.map(field => ({ value: field.key, label: `Sort: ${field.label}` }))}
            onChange={setSort}
            className="filter-select"
            containerClassName="library-manage-sort"
            ariaLabel="Sort library"
          />
          <button className="icon-btn library-manage-order filter-bar-btn"
            onClick={() => setOrder(o => o === 'asc' ? 'desc' : 'asc')}>
            {order === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
          {hasFilters && <button className="icon-btn" onClick={clearFilters}>✕ Clear</button>}
          <CustomSelect
            value={limit}
            options={PAGE_SIZE_OPTIONS.map(size => ({ value: size, label: `${size} / page` }))}
            onChange={value => setLimit(Number(value))}
            className="filter-select"
            containerClassName="filter-count-select"
            ariaLabel="Entries per page"
          />
          <button className="icon-btn filter-bar-btn" onClick={() => refreshView()} title="Refresh">Refresh</button>
        </div>

        <ListChips
          lists={lists}
          value={listFilter}
          unlistedCount={unlistedCount}
          onChange={setListFilter}
          onNew={() => openListsModal('add')}
          loading={loadingLists}
        />

        {/* Mobile-only: batch edit lives inline above the table in manage mode. */}
        {isManage && <div className="batch-mobile">{batchPanel}</div>}

        {error && (
          <div className="state-block">
            <div className="state-title">Error</div>
            <div className="state-detail">{error}</div>
            <button className="btn btn-outline state-retry-btn" onClick={() => load()}>Retry</button>
          </div>
        )}

        {!error && loading && (
          <div className="skeleton-page" aria-label="Loading library">
            <SkeletonTable headers={skeletonHeaders} rows={12} cover />
          </div>
        )}

        {!error && !loading && entries.length === 0 && (
          <div className="state-block">
            <div className="state-title">No entries found</div>
            <div className="state-detail">Try adjusting your filters.</div>
          </div>
        )}

        {!error && !loading && entries.length > 0 && isManage && (
          <div>
            <table className={`media-table library-table manage-entry-table${fixedTableClass}`} data-mobile-show="status">
              <thead>
                <tr>
                  <th className="col-select">
                    <button type="button" className={`box-toggle${allPageSelected ? ' is-on' : ''}`}
                      onClick={toggleSelectAll} aria-pressed={allPageSelected} aria-label="Select all on page">
                      {allPageSelected ? '[X]' : '[ ]'}
                    </button>
                  </th>
                  <SortTh field="title">Title</SortTh>
                  {manageCols.map(renderHead)}
                  {showActions && <th className="action-cell">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id}
                    className={`${selectedIds.has(entry.id) ? 'row-selected ' : ''}library-row-clickable library-row-selectable`.trim()}
                    onMouseDown={ev => { if (ev.shiftKey) ev.preventDefault(); }}
                    onClick={ev => handleSelectClick(ev, entry.id)}>
                    <td className="col-select">
                      <button type="button" className={`box-toggle${selectedIds.has(entry.id) ? ' is-on' : ''}`}
                        onMouseDown={ev => { if (ev.shiftKey) ev.preventDefault(); }}
                        onClick={ev => { ev.stopPropagation(); handleSelectClick(ev, entry.id); }}
                        aria-pressed={selectedIds.has(entry.id)} aria-label={`Select ${entry.title}`}>
                        {selectedIds.has(entry.id) ? '[X]' : '[ ]'}
                      </button>
                    </td>
                    <td>
                      <div className="cover-cell">
                        <div className="cover-thumb">
                          {entry.cover_url && <img src={entry.cover_url} alt="" referrerPolicy="no-referrer" onError={onCoverError} />}
                        </div>
                        <span className="media-name">{entry.title}</span>
                      </div>
                    </td>
                    {manageCols.map(c => renderManageCell(entry, c))}
                    {showActions && (
                      <td className="action-cell" onClick={ev => ev.stopPropagation()}>
                        <div className="action-cell-inner">
                          <button className="icon-btn table-action-btn"
                            onClick={() => { setDetailEntry(entry); setStartEditing(false); }}>view</button>
                          <button className="icon-btn edit table-action-btn"
                            onClick={() => { setDetailEntry(entry); setStartEditing(true); }}>edit</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination">
                {page > 1 && <button className="icon-btn" onClick={() => setPage(1)}>« First</button>}
                <button className="icon-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span className="pagination-text">Page {page} of {totalPages}</span>
                <button className="icon-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                {page < totalPages && <button className="icon-btn" onClick={() => setPage(totalPages)}>Last »</button>}
              </div>
            )}
          </div>
        )}

        {!error && !loading && entries.length > 0 && !isManage && (
          <div>
            <table className={`media-table library-table${fixedTableClass}`} data-mobile-show={mobileShow}>
              <thead>
                <tr>
                  <SortTh field="title">Title</SortTh>
                  {viewCols.map(renderHead)}
                  {showActions && <th className="action-cell">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const isConfirmDel = confirmDeleteId === e.id;
                  return (
                    <tr key={e.id} className="library-row-clickable" onClick={() => { setDetailEntry(e); setStartEditing(false); }}>
                      <td>
                        <div className="cover-cell">
                          <div className="cover-thumb">
                            {e.cover_url && <img src={e.cover_url} alt="" referrerPolicy="no-referrer" onError={onCoverError} />}
                          </div>
                          <span className="media-name">{e.title}</span>
                        </div>
                      </td>
                      {viewCols.map(c => renderViewCell(e, c))}
                      {showActions && (
                        <td className="action-cell" onClick={ev => ev.stopPropagation()}>
                          <div className="action-cell-inner">
                            {isConfirmDel ? (
                              <>
                                <span className="confirm-inline-text">sure?</span>
                                <button className="btn btn-danger table-action-btn"
                                  onClick={() => handleDeleteEntry(e.id)}>yes</button>
                                <button className="icon-btn table-action-btn"
                                  onClick={() => setConfirmDeleteId(null)}>no</button>
                              </>
                            ) : (
                              <>
                                <button className="icon-btn edit table-action-btn"
                                  onClick={() => { setDetailEntry(e); setStartEditing(true); }}>edit</button>
                                <button className="icon-btn danger table-action-btn"
                                  onClick={() => setConfirmDeleteId(e.id)}>delete</button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination">
                {page > 1 && <button className="icon-btn" onClick={() => setPage(1)}>« First</button>}
                <button className="icon-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span className="pagination-text">Page {page} of {totalPages}</span>
                <button className="icon-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                {page < totalPages && <button className="icon-btn" onClick={() => setPage(totalPages)}>Last »</button>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right sidebar ── */}
      <div className="sidebar-right">
        {/* Manage (multi-select) replaces Sort with the batch-edit tools in place. */}
        {isManage ? (
          <div className="batch-desktop">{batchPanel}</div>
        ) : (
          <>
            <p className="panel-title">Sort</p>
            <div className="lib-sort-list">
              {SORT_FIELDS.map(f => (
                <div key={f.key} className="sidebar-item lib-sort-item"
                  onClick={() => handleSort(f.key)}>
                  {f.label}
                  {sort === f.key && <span className="text-accent">{order === 'asc' ? ' ↑' : ' ↓'}</span>}
                </div>
              ))}
            </div>
          </>
        )}

        <p className="panel-title library-view-title">View</p>
        <button type="button" className={`source-chip library-view-chip${isManage ? ' is-on' : ''}`}
          onClick={() => changeMode(isManage ? 'view' : 'manage')}
          title="Select multiple entries to batch-edit or delete">
          <span className="source-box">{isManage ? '[x]' : '[ ]'}</span>
          Multi-select
        </button>
        <button type="button" className={`source-chip library-view-chip${showActions ? ' is-on' : ''}`}
          onClick={toggleQuickActions}
          title="Show per-row action buttons in the table">
          <span className="source-box">{showActions ? '[x]' : '[ ]'}</span>
          Quick Actions
        </button>
        <button type="button" className={`source-chip library-view-chip${!fixTitle ? ' is-on' : ''}`}
          onClick={toggleFixTitle}
          title="Use fluid table sizing instead of the compact fixed table layout">
          <span className="source-box">{!fixTitle ? '[x]' : '[ ]'}</span>
          Fluid Table
        </button>

        <div className="library-sidebar-section">
          <p className="panel-title">At a Glance</p>
          <div className="library-meter-block">
            <div className="library-meter-head">
              <span>Completion</span>
              <span className="text-green">{completionPct}%</span>
            </div>
            <div className="library-meter">
              <div className="library-meter-fill" style={{ '--completion-pct': `${completionPct}%` }} />
            </div>
          </div>
          <div className="stat-grid">
            <div className="stat-box">
              <span className="stat-val">{counts.current || 0}</span>
              <span className="stat-lbl">Current</span>
            </div>
            <div className="stat-box">
              <span className="stat-val">{counts.completed || 0}</span>
              <span className="stat-lbl">Completed</span>
            </div>
          </div>
        </div>

        <div className="library-sidebar-section">
          <p className="panel-title">Showing</p>
          <div className="stat-box library-showing-box">
            <span className="stat-val">{loading ? <SkeletonLine width={44} height={22} /> : entries.length}</span>
            <span className="stat-lbl">Entries</span>
          </div>
          {statusFilter && (
            <div className="library-filter-summary library-filter-summary-first">
              Filter: <span className="text-accent">{statusLabel(statusFilter)}</span>
            </div>
          )}
          {mediumFilter && (
            <div className="library-filter-summary">
              Medium: <span className="text-accent">{mediumFilter}</span>
            </div>
          )}
          {listFilter && (
            <div className="library-filter-summary">
              List: <span className="text-accent">{listFilter === UNLISTED_LIST ? 'Unlisted' : listFilter}</span>
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <AddEntryModal onClose={() => setShowAdd(false)} onCreated={() => { refreshView(); setShowAdd(false); }} />
      )}

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          onClose={() => { setDetailEntry(null); setStartEditing(false); }}
          onUpdated={(updated) => { handleUpdated(updated); if (isManage) setDetailEntry(updated); }}
          onDeleted={handleDeleted}
          initialEditing={startEditing}
        />
      )}

      {showLists && (
        <ListsModal
          initialTab={listModalTab}
          onClose={() => setShowLists(false)}
          existingLists={lists}
          onCreated={(name) => { setShowLists(false); setListFilter(name); setPage(1); loadLists(); }}
          onRenamed={(oldName, newName) => { if (listFilter === oldName) { setListFilter(newName); setPage(1); } loadLists(); }}
          onDeleted={(name) => { if (listFilter === name) { setListFilter(ALL_LISTS); setPage(1); } loadLists(); }}
        />
      )}

      {lastEntryWarning && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setLastEntryWarning(null)}>
          <div className="modal confirm-modal">
            <div className="modal-header">
              <span className="modal-title">Custom List Will Be Removed</span>
              <button className="icon-btn" onClick={() => setLastEntryWarning(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="confirm-copy">
                "{lastEntryWarning.entry.custom_list}" only contains this entry. Saving will remove the entry from that list, so the custom list will disappear.
              </p>
              <div className="confirm-actions">
                <button className="btn btn-outline" type="button" onClick={() => setLastEntryWarning(null)}>Cancel</button>
                <button className="btn btn-danger" type="button"
                  onClick={() => saveEntryList(lastEntryWarning.entry, lastEntryWarning.nextValue, { skipWarning: true })}>
                  Save Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
