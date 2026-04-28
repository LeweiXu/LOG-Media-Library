import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getEntries, updateEntry, deleteEntry, exportEntries, getSettings } from '../api.jsx';
import { statusLabel, fmtDate, progressPercent, progressLabel, extractItems, MEDIUMS, STATUSES, ORIGINS } from '../utils.jsx';
import AddEntryModal from './components/AddEntryModal.jsx';
import EntryDetailModal from './components/EntryDetailModal.jsx';
import ImportModal from './components/ImportModal.jsx';
import ImportAutoModal from './components/ImportAutoModal.jsx';
import ImportMalModal from './components/ImportMalModal.jsx';
import { SkeletonLine, SkeletonTable } from './components/Skeletons.jsx';

const SORT_FIELDS = [
  { key: 'title',        label: 'Title' },
  { key: 'medium',       label: 'Medium' },
  { key: 'rating',       label: 'Rating' },
  { key: 'status',       label: 'Status' },
  { key: 'year',         label: 'Year' },
  { key: 'updated_at',   label: 'Updated' },
  { key: 'completed_at', label: 'Completed' },
];

const PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100];
const DEFAULT_SORT = 'updated_at';
const DEFAULT_ORDER = 'desc';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 40;

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
  // Whether the URL explicitly supplied sort/limit at mount. Saved settings
  // are only applied if the URL did *not* — URL > settings > hard default.
  const urlHadSortRef  = useRef(searchParams.has('sort'));
  const urlHadLimitRef = useRef(searchParams.has('limit'));
  // Gate the first fetch on user settings being read so we don't load
  // 40-default rows then immediately re-load with the user's preference.
  const [settingsApplied, setSettingsApplied] = useState(false);
  const [entries,      setEntries]      = useState([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [counts,       setCounts]       = useState({});
  const [showAdd,        setShowAdd]        = useState(false);
  const [detailEntry,    setDetailEntry]    = useState(null);
  const [startEditing,   setStartEditing]   = useState(false);
  const [confirmDeleteId,setConfirmDeleteId] = useState(null);
  const [editingProgress,setEditingProgress] = useState(null); // { id, value }
  const [editingRating,  setEditingRating]   = useState(null); // { id, value }

  // Mobile drawer state — '', 'left', or 'right'. CSS reveals the matching
  // sidebar based on the layout's `data-drawer` attribute.
  const [drawer, setDrawer] = useState('');

  const [search,       setSearch]       = useState(() => searchParams.get('q') || (!hasUrlParams ? initialFilters.title : '') || '');
  const [statusFilter, setStatusFilter] = useState(() => validParam(searchParams.get('status'), STATUSES, !hasUrlParams ? initialFilters.status || '' : ''));
  const [mediumFilter, setMediumFilter] = useState(() => validParam(searchParams.get('medium'), MEDIUMS, !hasUrlParams ? initialFilters.medium || '' : ''));
  const [originFilter, setOriginFilter] = useState(() => validParam(searchParams.get('origin'), ORIGINS, !hasUrlParams ? initialFilters.origin || '' : ''));
  const [sort,         setSort]         = useState(() => validParam(searchParams.get('sort'), sortKeys, DEFAULT_SORT));
  const [order,        setOrder]        = useState(() => searchParams.get('order') === 'asc' ? 'asc' : DEFAULT_ORDER);
  const [page,         setPage]         = useState(() => positiveIntParam(searchParams.get('page'), DEFAULT_PAGE));
  const [limit,        setLimit]        = useState(() => validParam(Number(searchParams.get('limit')), PAGE_SIZE_OPTIONS, DEFAULT_LIMIT));

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); }
    try {
      const params = {
        ...(search       && { title:  search }),
        ...(statusFilter && { status: statusFilter }),
        ...(mediumFilter && { medium: mediumFilter }),
        ...(originFilter && { origin: originFilter }),
        sort, order, limit, offset: (page - 1) * limit,
      };

      const data  = await getEntries(params);
      const items = extractItems(data);
      setEntries(items);
      setTotal(data?.total ?? items.length);

      // build sidebar counts on first unfiltered load
      if (page === 1 && !search) {
        const allData = await getEntries({ limit: 2000 }).catch(() => data);
        const all     = extractItems(allData);
        const c = { _total: all.length };
        all.forEach(e => {
          c[e.status] = (c[e.status] || 0) + 1;
          if (e.medium) c[e.medium] = (c[e.medium] || 0) + 1;
        });
        setCounts(c);
      }
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, statusFilter, mediumFilter, originFilter, sort, order, page, limit]);

  // reset to page 1 when filters/sort/limit change
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setPage(1);
  }, [search, statusFilter, mediumFilter, originFilter, sort, order, limit]);

  // Apply saved user settings on mount (only when not overridden by URL).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        if (!urlHadSortRef.current && s.default_sort && sortKeys.includes(s.default_sort)) {
          setSort(s.default_sort);
        }
        if (!urlHadLimitRef.current && PAGE_SIZE_OPTIONS.includes(s.default_entries_per_page)) {
          setLimit(s.default_entries_per_page);
        }
      } catch { /* fall back to current state */ }
      finally { if (!cancelled) setSettingsApplied(true); }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (settingsApplied) load(); }, [load, settingsApplied]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (statusFilter) params.set('status', statusFilter);
    if (mediumFilter) params.set('medium', mediumFilter);
    if (originFilter) params.set('origin', originFilter);
    if (sort !== DEFAULT_SORT) params.set('sort', sort);
    if (order !== DEFAULT_ORDER) params.set('order', order);
    if (page !== DEFAULT_PAGE) params.set('page', String(page));
    if (limit !== DEFAULT_LIMIT) params.set('limit', String(limit));
    setSearchParams(params, { replace: true });
  }, [search, statusFilter, mediumFilter, originFilter, sort, order, page, limit, setSearchParams]);

  function handleSort(field) {
    if (sort === field) setOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSort(field); setOrder('asc'); }
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
      } catch (e) {
        alert('Update failed: ' + e.message);
      }
    }
  }

  async function handleRatingSave(id, value) {
    setEditingRating(null);
    const num = value !== '' ? parseFloat(value) : null;
    if (num !== null && (isNaN(num) || num < 0 || num > 10)) return;
    try {
      const updated = await updateEntry(id, { rating: num ?? undefined });
      setEntries(prev => prev.map(e => e.id === id ? { ...e, ...updated } : e));
    } catch (e) {
      alert('Update failed: ' + e.message);
    }
  }

  async function handleDeleteEntry(id) {
    try {
      await deleteEntry(id);
      setConfirmDeleteId(null);
      setEntries(prev => prev.filter(e => e.id !== id));
      setTotal(t => t - 1);
      load(true);
    } catch (e) {
      alert('Delete failed: ' + e.message);
    }
  }

  const handleUpdated = (updated) => {
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
  };
  const handleDeleted = (id) => {
    setConfirmDeleteId(null);
    setDetailEntry(null);
    setEntries(prev => prev.filter(e => e.id !== id));
    setTotal(t => t - 1);
    load(true);
  };

  const clearFilters = () => { setSearch(''); setStatusFilter(''); setMediumFilter(''); setOriginFilter(''); };
  const hasFilters   = search || statusFilter || mediumFilter || originFilter;
  const totalPages   = Math.ceil(total / limit);
  const SortTh = ({ field, className, children }) => (
    <th className={`sortable${className ? ' ' + className : ''}`}
      onClick={() => handleSort(field)}
      style={{ color: sort === field ? 'var(--accent)' : undefined }}>
      {children}
      {sort === field && <span style={{ marginLeft: 4, opacity: 0.7 }}>{order === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );

  const [showImport,     setShowImport]     = useState(false);
  const [showImportAuto, setShowImportAuto] = useState(false);
  const [showImportMal,  setShowImportMal]  = useState(false);

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

  // On mobile we always show cover/title + rating + the sort-derived
  // column, and the actions column is hidden. When the user is sorting
  // by rating (which is therefore already visible) we use the slot for
  // completed-date so the row still says something extra.
  const mobileShow = ({
    title:        'status',
    medium:       'medium',
    rating:       'completed',
    status:       'status',
    year:         'year',
    updated_at:   'updated',
    completed_at: 'completed',
  })[sort] || 'status';

  return (
    <div className="layout-3col" data-drawer={drawer}>
      {/* ── Mobile drawer backdrop ── */}
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer('')} aria-hidden="true" />
      )}

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
          {MEDIUMS.map(m => (
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
            </div>
          ))}
        </div>
      </div>

      {/* ── Main ── */}
      <div className="main-content">
        <div className="page-head">
          <div className="page-head-left">
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'left' ? '' : 'left')}
              aria-label="Toggle filters"
              title="Filters"
            >☰ Filters</button>
            <span className="page-title">Library</span>
            <span className="page-desc">
              {loading ? <SkeletonLine width={74} height={11} /> : `${total} entries`}
            </span>
          </div>
          <div className="page-head-mobile">
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'right' ? '' : 'right')}
              aria-label="Toggle sort and tools"
              title="Sort & tools"
            >⋯</button>
            <button className="btn" onClick={() => setShowAdd(true)}>+ Add Entry</button>
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
          <button className="icon-btn" onClick={() => load()} title="Refresh" style={{ padding: '5px 10px' }}>Refresh</button>
        </div>

        {error && (
          <div className="state-block">
            <div className="state-title">Error</div>
            <div className="state-detail">{error}</div>
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={load}>Retry</button>
          </div>
        )}

        {!error && loading && (
          <div className="skeleton-page" aria-label="Loading library">
            <SkeletonTable
              headers={['Title', 'Medium', 'Year', 'Progress', 'Status', 'Rating', 'Updated', 'Completed', 'Actions']}
              rows={12}
              cover
              widths={['78%', '64%', '42%', '70%', '68%', '44%', '58%', '58%', '76%']}
            />
          </div>
        )}

        {!error && !loading && entries.length === 0 && (
          <div className="state-block">
            <div className="state-title">No entries found</div>
            <div className="state-detail">Try adjusting your filters.</div>
          </div>
        )}

        {!error && !loading && entries.length > 0 && (
          <div>
              <table className="media-table" data-mobile-show={mobileShow}>
              <thead>
                <tr>
                  <SortTh field="title">Title</SortTh>
                  <SortTh field="medium" className="col-medium">Medium</SortTh>
                  <SortTh field="year"   className="col-year">Year</SortTh>
                  <th className="col-progress">Progress</th>
                  <SortTh field="status" className="col-status">Status</SortTh>
                  <SortTh field="rating" className="col-rating">Rating</SortTh>
                  <SortTh field="updated_at"   className="col-updated">Updated</SortTh>
                  <SortTh field="completed_at" className="col-completed">Completed</SortTh>
                  <th className="action-cell">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const pct = progressPercent(e);
                  const isEditingProg = editingProgress?.id === e.id;
                  const isConfirmDel  = confirmDeleteId === e.id;
                  return (
                    <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => { setDetailEntry(e); setStartEditing(false); }}>
                      <td>
                        <div className="cover-cell">
                          <div className="cover-thumb">
                            {e.cover_url && (
                              <img src={e.cover_url} alt=""
                                onError={ev => { ev.target.style.display = 'none'; }} />
                            )}
                          </div>
                          <span className="media-name">{e.title}</span>
                        </div>
                      </td>
                      <td className="col-medium"><span style={{ color: 'var(--dim)' }}>{e.medium}</span></td>
                      <td className="col-year"><span style={{ color: 'var(--dim)' }}>{e.year || '—'}</span></td>
                      <td className="col-progress" onClick={ev => ev.stopPropagation()}>
                        {isEditingProg ? (
                          <input
                            className="inline-select"
                            type="number" min="0"
                            style={{ width: 64 }}
                            value={editingProgress.value}
                            autoFocus
                            onChange={ev => setEditingProgress({ id: e.id, value: ev.target.value })}
                            onKeyDown={ev => {
                              if (ev.key === 'Enter') handleProgressSave(e.id, editingProgress.value);
                              if (ev.key === 'Escape') setEditingProgress(null);
                            }}
                            onBlur={() => handleProgressSave(e.id, editingProgress.value)}
                          />
                        ) : (
                          <div className="progress-cell"
                            title="Click to edit progress"
                            style={{ cursor: 'text' }}
                            onClick={() => setEditingProgress({ id: e.id, value: String(e.progress ?? '') })}>
                            {progressLabel(e)}
                            {pct > 0 && (
                              <div className="progress-mini">
                                <div className="progress-mini-fill" style={{ width: `${pct}%` }} />
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="col-status" onClick={ev => ev.stopPropagation()}>
                        <select className="inline-select" value={e.status}
                          onChange={ev => handleStatusChange(e.id, ev.target.value)}>
                          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                        </select>
                      </td>
                      <td className="col-rating" onClick={ev => ev.stopPropagation()}>
                        {editingRating?.id === e.id ? (
                          <input
                            className="inline-select"
                            type="number" min="0" max="10" step="0.5"
                            style={{ width: 64 }}
                            value={editingRating.value}
                            autoFocus
                            onChange={ev => setEditingRating({ id: e.id, value: ev.target.value })}
                            onKeyDown={ev => {
                              if (ev.key === 'Enter') handleRatingSave(e.id, editingRating.value);
                              if (ev.key === 'Escape') setEditingRating(null);
                            }}
                            onBlur={() => handleRatingSave(e.id, editingRating.value)}
                          />
                        ) : (
                          <span className="rating-cell" title="Click to edit rating"
                            style={{ cursor: 'text' }}
                            onClick={() => setEditingRating({ id: e.id, value: String(e.rating ?? '') })}>
                            {e.rating != null ? e.rating : '—'}<span>/10</span>
                          </span>
                        )}
                      </td>
                      <td className="col-updated"><span style={{ color: 'var(--dim)' }}>{fmtDate(e.updated_at)}</span></td>
                      <td className="col-completed"><span style={{ color: 'var(--dim)' }}>{fmtDate(e.completed_at)}</span></td>
                      <td className="action-cell" onClick={ev => ev.stopPropagation()}>
                        <div className="action-cell-inner">
                        {isConfirmDel ? (
                          <>
                            <span style={{ fontSize: 11, color: 'var(--red)' }}>sure?</span>
                            <button className="btn btn-danger"
                              style={{ padding: '2px 8px', fontSize: 11 }}
                              onClick={() => handleDeleteEntry(e.id)}>
                              yes
                            </button>
                            <button className="icon-btn"
                              style={{ padding: '2px 8px', fontSize: 11 }}
                              onClick={() => setConfirmDeleteId(null)}>
                              no
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="icon-btn"
                              style={{ color: 'var(--accent)', borderColor: 'var(--accent)', padding: '2px 8px', fontSize: 11 }}
                              onClick={() => { setDetailEntry(e); setStartEditing(true); }}>
                              edit
                            </button>
                            <button className="icon-btn danger"
                              style={{ padding: '2px 8px', fontSize: 11 }}
                              onClick={() => setConfirmDeleteId(e.id)}>
                              delete
                            </button>
                          </>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
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

      {/* ── Right sidebar ── */}
      <div className="sidebar-right">
        <p className="panel-title">Sort</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 18 }}>
          {SORT_FIELDS.map(f => (
            <div key={f.key} className="sidebar-item"
              style={{ padding: '4px 0', fontSize: 11 }}
              onClick={() => handleSort(f.key)}>
              {f.label}
              {sort === f.key && (
                <span style={{ color: 'var(--accent)' }}>{order === 'asc' ? ' ↑' : ' ↓'}</span>
              )}
            </div>
          ))}
        </div>

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
              {loading ? <SkeletonLine width={44} height={22} /> : entries.length}
            </span>
            <span className="stat-lbl">Entries</span>
          </div>
          {statusFilter && (
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6 }}>
              Filter: <span style={{ color: 'var(--accent)' }}>{statusLabel(statusFilter)}</span>
            </div>
          )}
          {mediumFilter && (
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
              Medium: <span style={{ color: 'var(--accent)' }}>{mediumFilter}</span>
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <AddEntryModal
          onClose={() => setShowAdd(false)}
          onCreated={() => { load(); setShowAdd(false); }}
        />
      )}

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          onClose={() => { setDetailEntry(null); setStartEditing(false); }}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          initialEditing={startEditing}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { load(); }}
        />
      )}

      {showImportAuto && (
        <ImportAutoModal
          onClose={() => setShowImportAuto(false)}
          onImported={() => { load(); }}
        />
      )}

      {showImportMal && (
        <ImportMalModal
          onClose={() => setShowImportMal(false)}
          onImported={() => { load(); }}
        />
      )}
    </div>
  );
}
