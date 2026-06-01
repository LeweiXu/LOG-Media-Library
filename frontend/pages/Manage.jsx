import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { batchDeleteEntries, batchUpdateEntries, exportEntries, getCustomLists, getEntries, getSettings, updateEntry } from '../api.jsx';
import { extractItems, fmtDate, progressLabel, statusLabel, STATUSES, MEDIUMS, ORIGINS, onCoverError } from '../utils.jsx';
import EntryDetailModal from './components/EntryDetailModal.jsx';
import ImportModal from './components/ImportModal.jsx';
import ImportAutoModal from './components/ImportAutoModal.jsx';
import ImportMalModal from './components/ImportMalModal.jsx';
import ListsModal from './components/ListsModal.jsx';
import DedupModal from './components/DedupModal.jsx';
import CacheCoversModal from './components/CacheCoversModal.jsx';
import ResyncModal from './components/ResyncModal.jsx';
import ExtensionInstallHint from './components/ExtensionInstallHint.jsx';
import { useExtensionPresent } from '../extensionBridge.js';
import { SkeletonLine, SkeletonTable } from './components/Skeletons.jsx';

const ALL = '__all__';
const UNLISTED = '';
// Fields offered by the "bulk edit field" tool, with their input kind.
const BULK_FIELDS = [
  { key: 'rating', label: 'Rating',  kind: 'number', min: 0, max: 10 },
  { key: 'medium', label: 'Medium',  kind: 'medium' },
  { key: 'origin', label: 'Origin',  kind: 'origin' },
  { key: 'year',   label: 'Year',    kind: 'number', min: 1800, max: 2100 },
  { key: 'total',  label: 'Total',   kind: 'number', min: 0 },
];
const PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100];
const DEFAULT_LIMIT = 40;
const DEFAULT_ORDER = 'desc';
const SORT_FIELDS = [
  { key: 'title',      label: 'Title' },
  { key: 'medium',     label: 'Medium' },
  { key: 'status',     label: 'Status' },
  { key: 'rating',     label: 'Rating' },
  { key: 'updated_at', label: 'Updated' },
];

function validPageSize(value, fallback = DEFAULT_LIMIT) {
  return PAGE_SIZE_OPTIONS.includes(value) ? value : fallback;
}

export default function Manage() {
  const [lists, setLists] = useState([]);
  const [unlistedCount, setUnlistedCount] = useState(0);
  const [selectedList, setSelectedList] = useState(ALL);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [showLists, setShowLists] = useState(false);
  const [listModalTab, setListModalTab] = useState('add');
  const [lastEntryWarning, setLastEntryWarning] = useState(null);
  const [detailEntry, setDetailEntry] = useState(null);
  const [startEditing, setStartEditing] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showImportAuto, setShowImportAuto] = useState(false);
  const [showImportMal, setShowImportMal] = useState(false);
  const [showDedup, setShowDedup] = useState(false);
  const [showCacheCovers, setShowCacheCovers] = useState(false);
  const [showResync, setShowResync] = useState(false);
  const extPresent = useExtensionPresent();
  // Bulk-selection + action state.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Entry id of the last toggled row — anchor for shift-click ranges.
  const lastSelectedId = useRef(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkListValue, setBulkListValue] = useState('');
  const [bulkStatusValue, setBulkStatusValue] = useState('');
  const [bulkField, setBulkField] = useState('');
  const [bulkFieldValue, setBulkFieldValue] = useState('');
  const [settingsApplied, setSettingsApplied] = useState(false);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('title');
  const [order, setOrder] = useState(DEFAULT_ORDER);

  const listNames = useMemo(() => lists.map(list => list.name), [lists]);
  const isAll = selectedList === ALL;
  const isUnlisted = selectedList === UNLISTED;
  const selectedLabel = isAll ? 'All Entries' : isUnlisted ? 'Unlisted' : selectedList;
  const totalPages = Math.ceil(total / limit);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    let nextLists = [];
    try {
      const [listData, unlistedData] = await Promise.all([
        getCustomLists(),
        getEntries({ custom_list_empty: true, limit: 1 }),
      ]);
      nextLists = Array.isArray(listData) ? listData : [];
      setLists(nextLists);
      setUnlistedCount(unlistedData?.total ?? extractItems(unlistedData).length);
    } finally {
      setLoadingLists(false);
    }
    return nextLists;
  }, []);

  const loadEntries = useCallback(async () => {
    if (!settingsApplied) return;
    setLoadingEntries(true);
    setError('');
    setSelectedIds(new Set());   // selection is per-view; never act on hidden rows
    lastSelectedId.current = null;
    setBulkListValue('');
    setBulkStatusValue('');
    setBulkField('');
    setBulkFieldValue('');
    try {
      const base = { ...(search && { title: search }), sort, order, limit, offset: (page - 1) * limit };
      const params = isAll
        ? base
        : isUnlisted
          ? { custom_list_empty: true, ...base }
          : { custom_list: selectedList, ...base };
      const data = await getEntries(params);
      const items = extractItems(data);
      setEntries(items);
      setTotal(data?.total ?? items.length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingEntries(false);
    }
  }, [isAll, isUnlisted, limit, order, page, search, selectedList, settingsApplied, sort]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (!cancelled) setLimit(validPageSize(settings.default_entries_per_page));
      } catch { /* fall back to default page size */ }
      finally { if (!cancelled) setSettingsApplied(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);
  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => { setPage(1); }, [selectedList, limit, search, sort, order]);

  function handleSort(field) {
    if (sort === field) setOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSort(field); setOrder(DEFAULT_ORDER); }
  }

  function isRemovingLastEntryFromList(entry, nextValue) {
    const currentList = entry.custom_list || '';
    if (!currentList || currentList === nextValue) return false;
    const currentMeta = lists.find(list => list.name === currentList);
    return currentMeta?.count === 1;
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
      const nextLists = await loadLists();
      const movedAway = selectedList ? nextValue !== selectedList : nextValue !== '';
      setEntries(prev => {
        const mapped = prev.map(e => e.id === entry.id ? { ...e, ...updated } : e);
        return movedAway ? mapped.filter(e => e.id !== entry.id) : mapped;
      });
      if (movedAway) setTotal(t => Math.max(0, t - 1));
      if (selectedList && !nextLists.some(list => list.name === selectedList)) {
        setSelectedList(UNLISTED);
      }
    } catch (err) {
      alert('Update failed: ' + err.message);
    } finally {
      setSaving('');
    }
  }

  const hasFilters = Boolean(search);
  const clearFilters = () => setSearch('');
  async function exportCSV() {
    try {
      const blob = await exportEntries();
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: 'library.csv',
      });
      a.click();
    } catch (err) {
      alert(`Export failed: ${err.message}`);
    }
  }

  function refreshView() {
    loadLists();
    loadEntries();
  }

  function openListsModal(tab = 'add') {
    setListModalTab(tab);
    setShowLists(true);
  }

  // ── Bulk selection ──────────────────────────────────────────────────────────
  const pageIds = useMemo(() => entries.map(e => e.id), [entries]);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));

  function toggleSelect(id, shiftKey = false) {
    setConfirmBulkDelete(false);   // changing the selection disarms a pending delete
    setSelectedIds(prev => {
      const next = new Set(prev);
      const index = entries.findIndex(entry => entry.id === id);
      const anchorIndex = entries.findIndex(entry => entry.id === lastSelectedId.current);
      // Shift-click applies the clicked row's intended action to the whole
      // range between the last toggled row and this one.
      if (shiftKey && anchorIndex !== -1 && index !== -1) {
        const shouldSelect = !prev.has(id);
        const lo = Math.min(anchorIndex, index);
        const hi = Math.max(anchorIndex, index);
        for (let i = lo; i <= hi; i++) {
          const rangeId = entries[i]?.id;
          if (rangeId == null) continue;
          if (shouldSelect) next.add(rangeId);
          else next.delete(rangeId);
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
    setSelectedIds(allPageSelected ? new Set() : new Set(pageIds));
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
    setBulkBusy(true);
    setBulkError('');
    try {
      await batchUpdateEntries(ids, patch);
      clearSelection();
      refreshView();
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  function bulkAssignList(value) {
    setBulkListValue(value);
    setBulkStatusValue('');
    setBulkField('');
    setBulkFieldValue('');
  }

  function bulkSetStatus(value) {
    setBulkStatusValue(value);
    setBulkListValue('');
    setBulkField('');
    setBulkFieldValue('');
  }

  function buildBulkPatch() {
    if (bulkListValue) {
      return { custom_list: bulkListValue === '__none__' ? null : bulkListValue };
    }
    if (bulkStatusValue) {
      return { status: bulkStatusValue };
    }
    if (!bulkField) return null;
    const meta = BULK_FIELDS.find(f => f.key === bulkField);
    if (!meta || bulkFieldValue === '') return null;
    let value = bulkFieldValue;
    if (meta?.kind === 'number') value = value === '' ? null : Number(value);
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
    setBulkBusy(true);
    setBulkError('');
    try {
      await batchDeleteEntries(ids);
      clearSelection();
      refreshView();
    } catch (err) {
      setBulkError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const SortTh = ({ field, className, children }) => (
    <th className={`sortable${className ? ' ' + className : ''}`}
      onClick={() => handleSort(field)}
      style={{ color: sort === field ? 'var(--accent)' : undefined }}>
      {children}
      {sort === field && <span style={{ marginLeft: 4, opacity: 0.7 }}>{order === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );

  return (
    <div className="layout-3col" data-drawer={drawer}>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer('')} aria-hidden="true" />
      )}

      <div className="sidebar-left">
        <div className="sidebar-section">
          <div
            className={`sidebar-item${isAll ? ' active' : ''}`}
            onClick={() => { setSelectedList(ALL); setDrawer(''); }}
          >
            All Entries
          </div>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="sidebar-label">Custom Lists</span>
          {lists.map(list => (
            <div
              key={list.name}
              className={`sidebar-item${selectedList === list.name ? ' active' : ''}`}
              onClick={() => { setSelectedList(list.name); setDrawer(''); }}
            >
              {list.name}
              <span className="sidebar-count">{list.count}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <div
            className={`sidebar-item${isUnlisted ? ' active' : ''}`}
            onClick={() => { setSelectedList(UNLISTED); setDrawer(''); }}
          >
            Unlisted
            {loadingLists
              ? <SkeletonLine width={24} height={14} />
              : <span className="sidebar-count">{unlistedCount}</span>}
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="page-head">
          <div className="page-head-left">
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'left' ? '' : 'left')}
              aria-label="Toggle custom lists"
              title="Custom lists"
            >☰ Lists</button>
            <span className="page-title">Manage</span>
            <span className="page-desc">·</span>
            <span className="page-desc" style={{ color: 'var(--text)', fontWeight: 600 }}>
              {selectedLabel}
            </span>
            <span className="page-desc">
              {loadingEntries ? <SkeletonLine width={74} height={11} /> : `${total} entries`}
            </span>
          </div>
          <div className="page-head-mobile">
            <button className="btn" onClick={() => openListsModal('add')}>+ Add List</button>
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'right' ? '' : 'right')}
              aria-label="Toggle tools"
              title="Tools"
            >⋯</button>
          </div>
        </div>

        <div className="filter-bar">
          <input placeholder="Search titles…" value={search} style={{ width: 200 }}
            onChange={e => setSearch(e.target.value)} />
          <select value={sort} onChange={e => setSort(e.target.value)}>
            {SORT_FIELDS.map(f => <option key={f.key} value={f.key}>Sort: {f.label}</option>)}
          </select>
          <button className="icon-btn" style={{ padding: '5px 10px' }}
            onClick={() => setOrder(o => o === 'asc' ? 'desc' : 'asc')}>
            {order === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
          {hasFilters && (
            <button className="icon-btn" onClick={clearFilters}>✕ Clear</button>
          )}
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            style={{ marginLeft: 'auto' }}>
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button className="icon-btn" onClick={() => { loadLists(); loadEntries(); }} title="Refresh" style={{ padding: '5px 10px' }}>
            Refresh
          </button>
        </div>

        {error && (
          <div className="state-block">
            <div className="state-title">Error</div>
            <div className="state-detail">{error}</div>
          </div>
        )}

        {!error && loadingEntries && (
          <div className="skeleton-page" aria-label="Loading entries">
            <SkeletonTable
              headers={['Title', 'Status', 'Medium', 'Rating', 'Progress', 'Updated', 'Custom List']}
              rows={12}
              cover
              widths={['78%', '56%', '64%', '48%', '72%', '58%', '80%']}
            />
          </div>
        )}

        {!error && !loadingEntries && entries.length === 0 && (
          <div className="state-block">
            <div className="state-title">No entries here</div>
            <div className="state-detail">
              Assign entries to a custom list from an entry form or move entries from another list.
            </div>
          </div>
        )}

        {!error && !loadingEntries && entries.length > 0 && (
          <div>
            <table className="media-table" data-mobile-show="status">
              <thead>
                <tr>
                  <th className="col-select">
                    <button type="button"
                      className={`box-toggle${allPageSelected ? ' is-on' : ''}`}
                      onClick={toggleSelectAll} aria-pressed={allPageSelected}
                      aria-label="Select all on page">
                      {allPageSelected ? '[X]' : '[ ]'}
                    </button>
                  </th>
                  <SortTh field="title">Title</SortTh>
                  <SortTh field="status" className="col-status">Status</SortTh>
                  <SortTh field="medium" className="col-medium">Medium</SortTh>
                  <SortTh field="rating" className="col-rating">Rating</SortTh>
                  <th className="col-progress">Progress</th>
                  <SortTh field="updated_at" className="col-updated">Updated</SortTh>
                  <th>Custom List</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.id} style={{ cursor: 'pointer', userSelect: 'none' }}
                    className={selectedIds.has(entry.id) ? 'row-selected' : undefined}
                    onMouseDown={ev => { if (ev.shiftKey) ev.preventDefault(); }}
                    onClick={ev => handleSelectClick(ev, entry.id)}>
                    <td className="col-select">
                      <button type="button"
                        className={`box-toggle${selectedIds.has(entry.id) ? ' is-on' : ''}`}
                        onMouseDown={ev => { if (ev.shiftKey) ev.preventDefault(); }}
                        onClick={ev => { ev.stopPropagation(); handleSelectClick(ev, entry.id); }}
                        aria-pressed={selectedIds.has(entry.id)}
                        aria-label={`Select ${entry.title}`}>
                        {selectedIds.has(entry.id) ? '[X]' : '[ ]'}
                      </button>
                    </td>
                    <td>
                      <div className="cover-cell">
                        <div className="cover-thumb">
                          {entry.cover_url && (
                            <img src={entry.cover_url} alt=""
                              referrerPolicy="no-referrer"
                              onError={onCoverError} />
                          )}
                        </div>
                        <span className="media-name">{entry.title}</span>
                      </div>
                    </td>
                    <td className="col-status">
                      <span className={`badge badge-${entry.status}`}>{statusLabel(entry.status)}</span>
                    </td>
                    <td className="col-medium">
                      <span style={{ color: 'var(--dim)' }}>{entry.medium || '—'}</span>
                    </td>
                    <td className="col-rating">
                      <span className="rating-cell">{entry.rating != null ? entry.rating : '—'}<span>/10</span></span>
                    </td>
                    <td className="col-progress">
                      <span style={{ color: 'var(--dim)' }}>{progressLabel(entry)}</span>
                    </td>
                    <td className="col-updated">
                      <span style={{ color: 'var(--dim)' }}>{fmtDate(entry.updated_at)}</span>
                    </td>
                    <td onClick={ev => ev.stopPropagation()}>
                      <select
                        className="inline-select"
                        value={entry.custom_list || ''}
                        disabled={saving === `entry:${entry.id}`}
                        onChange={ev => saveEntryList(entry, ev.target.value)}
                        style={{ minWidth: 180 }}
                      >
                        <option value="">No List</option>
                        {listNames.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', paddingBottom: 16 }}>
                {page > 1 && <button className="icon-btn" onClick={() => setPage(1)}>« First</button>}
                <button className="icon-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>Page {page} of {totalPages}</span>
                <button className="icon-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                {page < totalPages && <button className="icon-btn" onClick={() => setPage(totalPages)}>Last »</button>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-right">
        <p className="panel-title">Batch Edit</p>
        <div className="batch-panel">
          <div className={`batch-hint${selectedIds.size ? ' is-active' : ''}`}>
            {selectedIds.size ? `${selectedIds.size} selected` : 'Select entries to edit in bulk'}
          </div>

          <select className="inline-select batch-select" value={bulkListValue} disabled={bulkBusy || selectedIds.size === 0}
            onChange={e => bulkAssignList(e.target.value)}>
            <option value="" disabled>Assign to list…</option>
            {listNames.map(n => <option key={n} value={n}>{n}</option>)}
            <option value="__none__">— Remove from list —</option>
          </select>

          <select className="inline-select batch-select" value={bulkStatusValue} disabled={bulkBusy || selectedIds.size === 0}
            onChange={e => bulkSetStatus(e.target.value)}>
            <option value="" disabled>Set status…</option>
            {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>

          <select className="inline-select batch-select" value={bulkField} disabled={bulkBusy || selectedIds.size === 0}
            onChange={e => {
              setBulkField(e.target.value);
              setBulkFieldValue('');
              setBulkListValue('');
              setBulkStatusValue('');
            }}>
            <option value="">Edit field…</option>
            {BULK_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>

          {bulkField && (
            <div className="batch-field-row">
              {(() => {
                const meta = BULK_FIELDS.find(f => f.key === bulkField);
                if (meta.kind === 'medium' || meta.kind === 'origin') {
                  const opts = meta.kind === 'medium' ? MEDIUMS : ORIGINS;
                  return (
                    <select className="inline-select batch-select" value={bulkFieldValue} disabled={bulkBusy}
                      style={{ flex: 1 }}
                      onChange={e => setBulkFieldValue(e.target.value)}>
                      <option value="">Choose {meta.label.toLowerCase()}…</option>
                      {opts.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  );
                }
                return (
                  <input className="inline-select batch-select" type="number" placeholder={meta.label}
                    min={meta.min} max={meta.max} value={bulkFieldValue} disabled={bulkBusy}
                    style={{ flex: 1 }}
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
            <button className="icon-btn" disabled={bulkBusy} onClick={clearSelection}>Clear</button>
            <button className="icon-btn accent" disabled={bulkBusy || selectedIds.size === 0 || !buildBulkPatch()} onClick={applyBulkChange}>
              Apply
            </button>
          </div>

          {bulkError && <div style={{ color: 'var(--red)', fontSize: 11 }}>{bulkError}</div>}
        </div>

        <p className="panel-title">Tools</p>
        <button className="icon-btn" style={{ textAlign: 'left', padding: '6px 10px', width: '100%' }}
          onClick={() => openListsModal('manage')}>
          Manage Lists
        </button>
        <button className="icon-btn" style={{ textAlign: 'left', padding: '6px 10px', width: '100%', marginTop: 4 }}
          onClick={() => setShowDedup(true)}>
          Find Duplicates
        </button>
        <button className="icon-btn" style={{ textAlign: 'left', padding: '6px 10px', width: '100%', marginTop: 4 }}
          onClick={() => setShowCacheCovers(true)}>
          Cache Covers (server)
        </button>
        <button className="icon-btn" style={{ textAlign: 'left', padding: '6px 10px', width: '100%', marginTop: 4, marginBottom: extPresent ? 18 : 4 }}
          disabled={!extPresent}
          title={extPresent ? 'Resync covers via the browser extension' : 'Requires the Logarium browser extension'}
          onClick={() => setShowResync(true)}>
          Cache Covers (extension)
        </button>
        {!extPresent && (
          <div style={{ margin: '2px 0 18px' }}>
            <ExtensionInstallHint context="resync" />
          </div>
        )}

        <p className="panel-title">Export / Import</p>
        <button className="icon-btn" style={{ textAlign: 'left', padding: '6px 10px', width: '100%' }}
          onClick={exportCSV}>
          Export CSV
        </button>
        <button className="icon-btn" style={{ textAlign: 'left', padding: '6px 10px', width: '100%', marginTop: 4 }}
          onClick={() => setShowImport(true)}>
          Import CSV
        </button>
        <button className="icon-btn" style={{ textAlign: 'left', padding: '6px 10px', width: '100%', marginTop: 4 }}
          onClick={() => setShowImportAuto(true)}>
          Import (auto-search)
        </button>
        <button className="icon-btn" style={{ textAlign: 'left', padding: '6px 10px', width: '100%', marginTop: 4 }}
          onClick={() => setShowImportMal(true)}>
          Import (MAL XML)
        </button>

        <div style={{ marginTop: 20 }}>
          <p className="panel-title">Showing</p>
          <div className="stat-box" style={{ marginBottom: 8 }}>
            <span className="stat-val">
              {loadingEntries ? <SkeletonLine width={44} height={22} /> : entries.length}
            </span>
            <span className="stat-lbl">Entries</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6 }}>
            List: <span style={{ color: 'var(--accent)' }}>{selectedLabel}</span>
          </div>
        </div>
      </div>

      {showLists && (
        <ListsModal
          initialTab={listModalTab}
          onClose={() => setShowLists(false)}
          existingLists={lists}
          onCreated={(name) => {
            setShowLists(false);
            setSelectedList(name);
            setPage(1);
            loadLists();
          }}
          onRenamed={(oldName, newName) => {
            if (selectedList === oldName) {
              setSelectedList(newName);
              setPage(1);
            }
            loadLists();
          }}
          onDeleted={(name) => {
            if (selectedList === name) {
              setSelectedList(UNLISTED);
              setPage(1);
            }
            loadLists();
          }}
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
              <p style={{ margin: '0 0 16px', color: 'var(--dim)', fontSize: 13 }}>
                "{lastEntryWarning.entry.custom_list}" only contains this entry. Saving will remove the entry from that list, so the custom list will disappear.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-outline" type="button" onClick={() => setLastEntryWarning(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => saveEntryList(lastEntryWarning.entry, lastEntryWarning.nextValue, { skipWarning: true })}
                >
                  Save Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          onClose={() => { setDetailEntry(null); setStartEditing(false); }}
          onUpdated={(updated) => {
            setDetailEntry(updated);
            refreshView();
          }}
          onDeleted={() => {
            setDetailEntry(null);
            refreshView();
          }}
          initialEditing={startEditing}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={refreshView}
        />
      )}

      {showImportAuto && (
        <ImportAutoModal
          onClose={() => setShowImportAuto(false)}
          onImported={refreshView}
        />
      )}

      {showImportMal && (
        <ImportMalModal
          onClose={() => setShowImportMal(false)}
          onImported={refreshView}
        />
      )}

      {showDedup && (
        <DedupModal
          onClose={() => setShowDedup(false)}
          onResolved={refreshView}
        />
      )}

      {showCacheCovers && (
        <CacheCoversModal onClose={() => setShowCacheCovers(false)} />
      )}

      {showResync && (
        <ResyncModal onClose={() => setShowResync(false)} />
      )}
    </div>
  );
}
