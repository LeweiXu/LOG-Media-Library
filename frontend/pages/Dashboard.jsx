import { useState, useEffect, useCallback, useRef } from 'react';
import { getEntries, getStats, updateEntry } from '../api.jsx';
import { statusLabel, badgeClass, fmtDate, progressLabel, progressPercent, timeAgo, extractItems, STATUSES, logDotClass } from '../utils.jsx';
import AddEntryModal from './components/AddEntryModal.jsx';
import EntryDetailModal from './components/EntryDetailModal.jsx';
import { SkeletonActivity, SkeletonLine, SkeletonSidebarRows, SkeletonStatGrid, SkeletonTable } from './components/Skeletons.jsx';

function CoverThumb({ url, title }) {
  return (
    <div className="cover-thumb">
      {url && (
        <img src={url} alt={title}
          onError={e => { e.target.style.display = 'none'; }} />
      )}
    </div>
  );
}

export default function DashboardAlt({ onFilterChange }) {
  const [stats,           setStats]           = useState(null);
  const [current,         setCurrent]         = useState([]);
  const [planned,         setPlanned]         = useState([]);
  const [recent,          setRecent]          = useState([]);
  const [activity,        setActivity]        = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState('');
  const [showAdd,         setShowAdd]         = useState(false);
  const [detailEntry,     setDetailEntry]     = useState(null);
  const [editingProgress, setEditingProgress] = useState(null); // { id, value }
  const [editingRating,   setEditingRating]   = useState(null); // { id, value }
  // Mobile drawer state — '', 'left', or 'right'.
  const [drawer,          setDrawer]          = useState('');
  const [barsReady,       setBarsReady]       = useState(false);
  const barsRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); }
    try {
      const [statsData, currentData, completedData, onHoldData, droppedData, plannedData] = await Promise.all([
        getStats().catch(() => null),
        getEntries({ status: 'current',   limit: 20 }),
        getEntries({ status: 'completed', limit: 20, sort: 'completed_at', order: 'desc' }),
        getEntries({ status: 'on_hold',   limit: 6,  sort: 'updated_at', order: 'desc' }),
        getEntries({ status: 'dropped',   limit: 6,  sort: 'updated_at', order: 'desc' }),
        getEntries({ status: 'planned',   limit: 20, sort: 'updated_at', order: 'desc' }),
      ]);

      const currentItems   = extractItems(currentData);
      const completedItems = extractItems(completedData);
      const onHoldItems    = extractItems(onHoldData);
      const droppedItems   = extractItems(droppedData);
      const plannedItems   = extractItems(plannedData);

      setStats(statsData);
      setCurrent(currentItems);
      setPlanned(plannedItems);
      setRecent(completedItems);

      const acts = [
        ...completedItems.slice(0, 6).map(e => ({ type: 'completed', entry: e, time: e.updated_at || e.completed_at })),
        ...currentItems.slice(0, 4).map(e  => ({ type: 'current',   entry: e, time: e.created_at })),
        ...onHoldItems.map(e               => ({ type: 'on_hold',   entry: e, time: e.updated_at })),
        ...droppedItems.map(e              => ({ type: 'dropped',   entry: e, time: e.updated_at })),
        ...plannedItems.map(e              => ({ type: 'planned',   entry: e, time: e.updated_at })),
      ]
        .filter(a => a.time)
        .sort((a, b) => new Date(b.time) - new Date(a.time))
        .slice(0, 8);
      setActivity(acts);
    } catch (e) {
      if (!silent) setError(e.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const monthBarsData = stats?.entries_per_month ?? [];
  useEffect(() => {
    if (monthBarsData.length > 0) {
      setBarsReady(false);
      barsRef.current = requestAnimationFrame(() => setBarsReady(true));
      return () => cancelAnimationFrame(barsRef.current);
    }
  }, [monthBarsData.length]);

  async function handleStatusChange(id, newStatus) {
    try {
      const updated = await updateEntry(id, { status: newStatus });
      if (newStatus === 'current') {
        setCurrent(c => c.map(e => e.id === id ? { ...e, ...updated } : e));
        setPlanned(p => p.filter(e => e.id !== id));
      } else if (newStatus === 'planned') {
        setPlanned(p => p.map(e => e.id === id ? { ...e, ...updated } : e));
        setCurrent(c => c.filter(e => e.id !== id));
      } else {
        setCurrent(c => c.filter(e => e.id !== id));
        setPlanned(p => p.filter(e => e.id !== id));
      }
      load(true);
    } catch (e) {
      alert('Failed to update: ' + e.message);
    }
  }

  function refreshEntry(updated) {
    setCurrent(c => c.map(e => e.id === updated.id ? { ...e, ...updated } : e));
    setPlanned(p => p.map(e => e.id === updated.id ? { ...e, ...updated } : e));
    setRecent(r  => r.map(e => e.id === updated.id ? { ...e, ...updated } : e));
  }

  async function handleProgressSave(id, value) {
    setEditingProgress(null);
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      try {
        const updated = await updateEntry(id, { progress: num });
        refreshEntry(updated);
        load(true);
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
      refreshEntry(updated);
      load(true);
    } catch (e) {
      alert('Update failed: ' + e.message);
    }
  }

  const handleUpdated = (updated) => {
    setCurrent(c => c.map(e => e.id === updated.id ? updated : e));
    setPlanned(p => p.map(e => e.id === updated.id ? updated : e));
    load(true);
  };

  const handleDeleted = (id) => {
    setCurrent(c => c.filter(e => e.id !== id));
    setPlanned(p => p.filter(e => e.id !== id));
    setDetailEntry(null);
    load(true);
  };

  const s       = stats || {};
  const maxBar  = monthBarsData.length ? Math.max(...monthBarsData.map(m => m.count), 1) : 1;
  return (
    <div className="layout-3col" data-drawer={drawer}>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer('')} aria-hidden="true" />
      )}
      {/* ── Left sidebar ── */}
      <div className="sidebar-left">
        <div className="sidebar-section">
          <span className="sidebar-label">Status</span>
          {[
            ['',          'All Entries', s.total],
            ['current',   'Current',     s.current],
            ['planned',   'Planned',     s.planned],
            ['completed', 'Completed',   s.completed],
            ['on_hold',   'On Hold',     s.on_hold],
            ['dropped',   'Dropped',     s.dropped],
          ].map(([key, label, count]) => (
            <div key={key} className="sidebar-item"
              onClick={() => onFilterChange({ status: key })}>
              {label}
              {loading
                ? <SkeletonLine width={24} height={14} />
                : count != null && <span className="sidebar-count">{count}</span>}
            </div>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="sidebar-label">Medium</span>
          {loading
            ? <SkeletonSidebarRows rows={6} />
            : (s.by_medium ?? []).map(({ medium, count }) => (
                <div key={medium} className="sidebar-item"
                  onClick={() => onFilterChange({ medium })}>
                  {medium} <span className="sidebar-count">{count}</span>
                </div>
              ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="sidebar-label">Origin</span>
          {loading
            ? <SkeletonSidebarRows rows={5} />
            : (s.by_origin ?? []).map(({ origin, count }) => (
                <div key={origin} className="sidebar-item"
                  onClick={() => onFilterChange({ origin })}>
                  {origin} <span className="sidebar-count">{count}</span>
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
            <span className="page-title">Dashboard</span>
            <span className="page-desc">personal media log</span>
          </div>
          <div className="page-head-mobile">
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'right' ? '' : 'right')}
              aria-label="Toggle summary"
              title="Summary"
            >⋯</button>
            <button className="btn" onClick={() => setShowAdd(true)}>+ Add Entry</button>
          </div>
        </div>

        {error && (
          <div className="state-block">
            <div className="state-title">Connection Error</div>
            <div className="state-detail">{error}</div>
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={load}>Retry</button>
          </div>
        )}

        {!error && loading && (
          <div className="skeleton-page" aria-label="Loading dashboard">
            <div
              className="dash-pair-skeleton"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0 24px',
                alignItems: 'start',
              }}>
              <div>
                <div className="section-header">Currently Consuming</div>
                <SkeletonTable
                  headers={['Title', 'Type', 'Progress', 'Status', 'Rating']}
                  rows={8}
                  cover
                  widths={['78%', '58%', '72%', '66%', '46%']}
                />
              </div>
              <div>
                <div className="section-header">Planned</div>
                <SkeletonTable
                  headers={['Title', 'Type', 'Progress', 'Status', 'Rating']}
                  rows={8}
                  cover
                  widths={['74%', '54%', '64%', '66%', '46%']}
                />
              </div>
            </div>

            <div>
              <div className="section-header">Recently Completed</div>
              <SkeletonTable
                headers={['Title', 'Type', 'Progress', 'Completed', 'Status', 'Rating']}
                rows={7}
                cover
                widths={['76%', '60%', '68%', '58%', '62%', '42%']}
              />
            </div>
          </div>
        )}

        {!error && !loading && (
          <>
          {/* Side-by-side layout for the two tables */}
            <div
              className="dash-pair"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 24px', alignItems: 'start' }}>

            {/* Currently Consuming */}
            <div>
                <div className="section-header">Currently Consuming</div>
                {current.length === 0
                ? <div style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 24 }}>No active entries.</div>
                : (
                    <>
                    <table className="media-table" data-mobile-show="progress">
                    <thead>
                        <tr>
                        <th>Title</th>
                        <th className="col-medium">Type</th>
                        <th className="col-progress">Progress</th>
                        <th className="col-status">Status</th>
                        <th className="col-rating">Rating</th>
                        </tr>
                    </thead>
                    <tbody>
                        {current.slice(0, 10).map(e => {
                        const pct = progressPercent(e);
                        const isEditingProg   = editingProgress?.id === e.id;
                        const isEditingRating = editingRating?.id === e.id;
                        return (
                            <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setDetailEntry(e)}>
                            <td>
                                <div className="cover-cell">
                                <CoverThumb url={e.cover_url} title={e.title} />
                                <span className="media-name">{e.title}</span>
                                </div>
                            </td>
                            <td className="col-medium"><span style={{ color: 'var(--dim)' }}>{e.medium ?? '—'}</span></td>
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
                                {isEditingRating ? (
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
                            </tr>
                        );
                        })}
                    </tbody>
                    </table>
                    {/* {current.length > 10 && (
                        <button className="icon-btn" style={{ marginTop: -20, marginBottom: 24, fontSize: 11 }}
                        onClick={() => onFilterChange({ status: 'current' })}>
                        Show all ({current.length}+)
                        </button>
                    )} */}
                    </>
                )
                }
            </div>

            {/* Planned */}
            <div>
                <div className="section-header">Planned</div>
                {planned.length === 0
                ? <div style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 24 }}>No planned entries.</div>
                : (
                    <>
                    <table className="media-table" data-mobile-show="progress">
                    <thead>
                        <tr>
                        <th>Title</th>
                        <th className="col-medium">Type</th>
                        <th className="col-progress">Progress</th>
                        <th className="col-status">Status</th>
                        <th className="col-rating">Rating</th>
                        </tr>
                    </thead>
                    <tbody>
                        {planned.slice(0, 10).map(e => {
                        const pct = progressPercent(e);
                        const isEditingProg   = editingProgress?.id === e.id;
                        const isEditingRating = editingRating?.id === e.id;
                        return (
                        <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setDetailEntry(e)}>
                            <td>
                            <div className="cover-cell">
                                <CoverThumb url={e.cover_url} title={e.title} />
                                <span className="media-name">{e.title}</span>
                            </div>
                            </td>
                            <td><span style={{ color: 'var(--dim)' }}>{e.medium ?? '—'}</span></td>
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
                            <td className="col-status" onClick={ev => ev.stopPropagation()}>
                            <select className="inline-select" value={e.status}
                                onChange={ev => handleStatusChange(e.id, ev.target.value)}>
                                {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                            </select>
                            </td>
                            <td className="col-rating" onClick={ev => ev.stopPropagation()}>
                            {isEditingRating ? (
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
                        </tr>
                        );
                        })}
                    </tbody>
                    </table>
                    {/* {planned.length > 10 && (
                        <button className="icon-btn" style={{ marginTop: -20, marginBottom: 24, fontSize: 11 }}
                        onClick={() => onFilterChange({ status: 'planned' })}>
                        Show all ({planned.length}+)
                        </button>
                    )} */}
                    </>
                )
                }
            </div>

            </div>

            <div>
      <div className="section-header">Recently Completed</div>
      {recent.length === 0
      ? <div style={{ color: 'var(--dim)', fontSize: 12 }}>No completed entries yet.</div>
      : (
        <table className="media-table" data-mobile-show="completed">
                <thead>
                    <tr>
                    <th>Title</th>
                    <th className="col-medium">Type</th>
                    <th className="col-progress">Progress</th>
                    <th className="col-completed">Completed</th>
                    <th className="col-status">Status</th>
                    <th className="col-rating">Rating</th>
                    </tr>
                </thead>
                <tbody>
                    {recent.map(e => {
                    const pct = progressPercent(e);
                    const isEditingProg   = editingProgress?.id === e.id;
                    const isEditingRating = editingRating?.id === e.id;
                    return (
                    <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setDetailEntry(e)}>
                        <td>
                        <div className="cover-cell">
                            <CoverThumb url={e.cover_url} title={e.title} />
                            <span className="media-name">{e.title}</span>
                        </div>
                        </td>
                        <td className="col-medium"><span style={{ color: 'var(--dim)' }}>{[e.medium, e.origin].filter(Boolean).join(' / ')}</span></td>
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
                        <td className="col-completed"><span style={{ color: 'var(--dim)' }}>{fmtDate(e.completed_at || e.updated_at)}</span></td>
                        <td className="col-status"><span className={badgeClass(e.status)}>{statusLabel(e.status)}</span></td>
                        <td className="col-rating" onClick={ev => ev.stopPropagation()}>
                        {isEditingRating ? (
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
                    </tr>
                    );
                    })}
                </tbody>
                </table>
            )
            }
            </div>

        </>
        )}
      </div>

      {/* ── Right sidebar ── */}
      <div className="sidebar-right">
        <p className="panel-title">Summary</p>
        {loading ? (
          <SkeletonStatGrid />
        ) : (
          <div className="stat-grid">
            <div className="stat-box">
              <span className="stat-val">{s.total ?? '—'}</span>
              <span className="stat-lbl">Total</span>
            </div>
            <div className="stat-box">
              <span className="stat-val">{s.avg_rating ? s.avg_rating.toFixed(1) : '—'}</span>
              <span className="stat-lbl">Avg Rating</span>
            </div>
            <div className="stat-box">
              <span className="stat-val">{s.current ?? current.length}</span>
              <span className="stat-lbl">Active</span>
            </div>
            <div className="stat-box">
              <span className="stat-val">{s.planned ?? '—'}</span>
              <span className="stat-lbl">Planned</span>
            </div>
          </div>
        )}

        {loading && (
          <>
            <p className="panel-title">Consumed / Month</p>
            <div className="chart-area skeleton-mini-chart" aria-hidden="true">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="bar-col">
                  <SkeletonLine width="100%" height={`${18 + (i % 4) * 8}px`} />
                  <SkeletonLine width="80%" height={8} />
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && monthBarsData.length > 0 && (
          <>
            <p className="panel-title">Consumed / Month</p>
            <div className="chart-area">
              {monthBarsData.slice(-7).map((m, i) => (
                <div key={i} className="bar-col">
                  <div className="bar-fill"
                    style={{ height: barsReady ? `${Math.round((m.count / maxBar) * 100)}%` : '0%' }} />
                  <span className="bar-label">{m.month ?? m.label ?? ''}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="panel-title" style={{ marginTop: 18 }}>Activity Log</p>
        {loading
          ? <SkeletonActivity rows={8} />
          : activity.length === 0
          ? <div style={{ color: 'var(--dim)', fontSize: 11 }}>No recent activity.</div>
          : activity.map((a, i) => (
              <div key={i} className="log-entry">
                <div className={logDotClass(a.type)} />
                <div>
                  <div className="log-text">
                    {a.type === 'completed' ? 'Completed ' :
                     a.type === 'current'   ? 'Started ' :
                     a.type === 'on_hold'   ? 'Put on hold ' :
                     a.type === 'dropped'   ? 'Dropped ' :
                     a.type === 'planned'   ? 'Planned ' : ''}
                    <strong>{a.entry.title}</strong>
                  </div>
                  <span className="log-time">{timeAgo(a.time)}</span>
                </div>
              </div>
            ))
        }
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
          onClose={() => setDetailEntry(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
