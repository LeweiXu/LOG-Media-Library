import { useState, useEffect, useCallback } from 'react';
import { getEntries, updateEntry, deleteEntry, exportEntries } from '../api.jsx';
import { statusLabel, fmtDate, progressPercent, progressLabel, extractItems, MEDIUMS, STATUSES, ORIGINS } from '../utils.jsx';
import AddEntryModal from './components/AddEntryModal.jsx';
import EntryDetailModal from './components/EntryDetailModal.jsx';
import ImportModal from './components/ImportModal.jsx';
import ImportAutoModal from './components/ImportAutoModal.jsx';
import ImportMalModal from './components/ImportMalModal.jsx';

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

export default function Library({ initialFilters = {} }) {
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

  const [search,       setSearch]       = useState(initialFilters.title  || '');
  const [statusFilter, setStatusFilter] = useState(initialFilters.status || '');
  const [mediumFilter, setMediumFilter] = useState(initialFilters.medium || '');
  const [originFilter, setOriginFilter] = useState(initialFilters.origin || '');
  const [sort,         setSort]         = useState('updated_at');
  const [order,        setOrder]        = useState('desc');
  const [page,         setPage]         = useState(1);
  const [limit,        setLimit]        = useState(40);

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
  useEffect(() => { setPage(1); }, [search, statusFilter, mediumFilter, originFilter, sort, order, limit]);
  useEffect(() => { load(); }, [load]);

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
    load(true);
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

  const SortTh = ({ field, children }) => (
    <th className="sortable"
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

  return (
    <div className="layout-3col">
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
              <span className="sidebar-count">{v === '' ? (counts._total || 0) : (counts[v] || 0)}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="sidebar-label">Medium</span>
          <div className={`sidebar-item${mediumFilter === '' ? ' active' : ''}`} onClick={() => setMediumFilter('')}>All</div>
          {MEDIUMS.map(m => (
            <div key={m} className={`sidebar-item${mediumFilter === m ? ' active' : ''}`} onClick={() => setMediumFilter(m)}>
              {m} <span className="sidebar-count">{counts[m] || 0}</span>
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
            <span className="page-title">Library</span>
            <span className="page-desc">{total} entries</span>
          </div>
          <button className="btn" onClick={() => setShowAdd(true)}>+ Add Entry</button>
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
          <div className="state-block">
            <span className="loading-dots">Loading library</span>
          </div>
        )}

        {!error && !loading && entries.length === 0 && (
          <div className="state-block">
            <div className="state-title">No entries found</div>
            <div className="state-detail">Try adjusting your filters.</div>
          </div>
        )}

        {!error && !loading && entries.length > 0 && (
          <>
              <table className="media-table">
              <thead>
                <tr>
                  <SortTh field="title">Title</SortTh>
                  <SortTh field="medium">Medium</SortTh>
                  <SortTh field="year">Year</SortTh>
                  <th>Progress</th>
                  <SortTh field="status">Status</SortTh>
                  <SortTh field="rating">Rating</SortTh>
                  <SortTh field="updated_at">Updated</SortTh>
                  <SortTh field="completed_at">Completed</SortTh>
                  <th>Actions</th>
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
                      <td><span style={{ color: 'var(--dim)' }}>{e.medium}</span></td>
                      <td><span style={{ color: 'var(--dim)' }}>{e.year || '—'}</span></td>
                      <td onClick={ev => ev.stopPropagation()}>
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
                      <td onClick={ev => ev.stopPropagation()}>
                        <select className="inline-select" value={e.status}
                          onChange={ev => handleStatusChange(e.id, ev.target.value)}>
                          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                        </select>
                      </td>
                      <td onClick={ev => ev.stopPropagation()}>
                        {editingRating?.id === e.id ? (
                          <input
                            className="inline-select"
                            type="number" min="0" max="10" step="0.1"
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
                      <td><span style={{ color: 'var(--dim)' }}>{fmtDate(e.updated_at)}</span></td>
                      <td><span style={{ color: 'var(--dim)' }}>{fmtDate(e.completed_at)}</span></td>
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
          </>
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
            <span className="stat-val">{entries.length}</span>
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
