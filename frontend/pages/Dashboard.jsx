import { useState, useEffect, useCallback } from 'react';
import { getEntries, getStats, updateEntry } from '../api.jsx';
import { statusLabel, badgeClass, fmtDate, progressPercent, progressLabel, timeAgo, extractItems, STATUSES, logDotClass } from '../utils.jsx';
import AddEntryModal from './components/AddEntryModal.jsx';
import EntryDetailModal from './components/EntryDetailModal.jsx';

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

function MediaRow({ entry, onOpen, onStatusChange }) {
  const pct = progressPercent(entry);
  return (
    <tr style={{ cursor: 'pointer' }} onClick={() => onOpen(entry)}>
      <td>
        <div className="cover-cell">
          <CoverThumb url={entry.cover_url} title={entry.title} />
          <span className="media-name">{entry.title}</span>
        </div>
      </td>
      <td><span style={{ color: 'var(--dim)' }}>{[entry.medium, entry.origin].filter(Boolean).join(' / ')}</span></td>
      <td>
        <div className="progress-cell">
          {progressLabel(entry)}
          {pct > 0 && (
            <div className="progress-mini">
              <div className="progress-mini-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </td>
      <td onClick={e => e.stopPropagation()}>
        <select className="inline-select" value={entry.status}
          onChange={e => onStatusChange(entry.id, e.target.value)}>
          {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </td>
      <td>
        <span className="rating-cell">
          {entry.rating != null ? entry.rating : '—'}<span>/10</span>
        </span>
      </td>
    </tr>
  );
}

export default function Dashboard({ onFilterChange }) {
  const [stats,     setStats]     = useState(null);
  const [current,   setCurrent]   = useState([]);
  const [recent,    setRecent]    = useState([]);
  const [activity,  setActivity]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showAdd,   setShowAdd]   = useState(false);
  const [detailEntry, setDetailEntry] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [statsData, currentData, completedData, onHoldData, droppedData, plannedData] = await Promise.all([
        getStats().catch(() => null),
        getEntries({ status: 'current', limit: 20 }),
        getEntries({ status: 'completed', limit: 8, sort: 'updated_at', order: 'desc' }),
        getEntries({ status: 'on_hold',   limit: 6, sort: 'updated_at', order: 'desc' }),
        getEntries({ status: 'dropped',   limit: 6, sort: 'updated_at', order: 'desc' }),
        getEntries({ status: 'planned',   limit: 6, sort: 'updated_at', order: 'desc' }),
      ]);

      const currentItems   = extractItems(currentData);
      const completedItems = extractItems(completedData);
      const onHoldItems    = extractItems(onHoldData);
      const droppedItems   = extractItems(droppedData);
      const plannedItems   = extractItems(plannedData);

      setStats(statsData);
      setCurrent(currentItems);
      setRecent(completedItems.slice(0, 5));

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
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleStatusChange(id, newStatus) {
    try {
      const updated = await updateEntry(id, { status: newStatus });
      if (newStatus === 'current') {
        setCurrent(c => c.map(e => e.id === id ? { ...e, ...updated } : e));
      } else {
        setCurrent(c => c.filter(e => e.id !== id));
      }
      setRecent(r => r.map(e => e.id === id ? { ...e, ...updated } : e));
      setActivity(a => a.map(act => act.entry.id === id
        ? { ...act, entry: { ...act.entry, ...updated } }
        : act));
    } catch (e) {
      alert('Failed to update: ' + e.message);
    }
  }

  const handleUpdated = (updated) => {
    setCurrent(c => c.map(e => e.id === updated.id ? updated : e));
    setRecent(r  => r.map(e => e.id === updated.id ? updated : e));
  };

  const handleDeleted = (id) => {
    setCurrent(c => c.filter(e => e.id !== id));
    setRecent(r  => r.filter(e => e.id !== id));
    setActivity(a => a.filter(act => act.entry.id !== id));
    setDetailEntry(null);
  };

  const s            = stats || {};
  const totalCount   = s.total    ?? (current.length + recent.length);
  const avgRating    = s.avg_rating ?? (recent.filter(e => e.rating).reduce((a, e, _, arr) => a + e.rating / arr.length, 0) || null);
  const plannedCount = s.planned  ?? '—';
  const activeCount  = s.current  ?? current.length;
  const monthBars    = s.entries_per_month ?? [];
  const maxBar       = monthBars.length ? Math.max(...monthBars.map(m => m.count), 1) : 1;

  return (
    <div className="layout-3col">
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
              {count != null && <span className="sidebar-count">{count}</span>}
            </div>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="sidebar-label">Medium</span>
          {(s.by_medium ?? []).map(({ medium, count }) => (
            <div key={medium} className="sidebar-item"
              onClick={() => onFilterChange({ medium })}>
              {medium} <span className="sidebar-count">{count}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <span className="sidebar-label">Origin</span>
          {(s.by_origin ?? []).map(({ origin, count }) => (
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
            <span className="page-title">Dashboard</span>
            <span className="page-desc">personal media log</span>
          </div>
          <button className="btn" onClick={() => setShowAdd(true)}>+ Add Entry</button>
        </div>

        {error && (
          <div className="state-block">
            <div className="state-title">Connection Error</div>
            <div className="state-detail">{error}</div>
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={load}>Retry</button>
          </div>
        )}

        {!error && loading && (
          <div className="state-block">
            <span className="loading-dots">Connecting to server</span>
          </div>
        )}

        {!error && !loading && (
          <>
            <div className="section-header">Currently Consuming</div>
            {current.length === 0
              ? <div style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 24 }}>No active entries.</div>
              : (
                <table className="media-table">
                  <thead>
                    <tr>
                      <th>Title</th><th>Type</th><th>Progress</th>
                      <th>Status</th><th>Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.map(e => (
                      <MediaRow key={e.id} entry={e}
                        onOpen={setDetailEntry} onStatusChange={handleStatusChange} />
                    ))}
                  </tbody>
                </table>
              )
            }

            <div className="section-header">Recently Completed</div>
            {recent.length === 0
              ? <div style={{ color: 'var(--dim)', fontSize: 12 }}>No completed entries yet.</div>
              : (
                <table className="media-table">
                  <thead>
                    <tr>
                      <th>Title</th><th>Type</th><th>Completed</th>
                      <th>Status</th><th>Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map(e => (
                      <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setDetailEntry(e)}>
                        <td>
                          <div className="cover-cell">
                            <CoverThumb url={e.cover_url} title={e.title} />
                            <span className="media-name">{e.title}</span>
                          </div>
                        </td>
                        <td><span style={{ color: 'var(--dim)' }}>{[e.medium, e.origin].filter(Boolean).join(' / ')}</span></td>
                        <td><span style={{ color: 'var(--dim)' }}>{fmtDate(e.completed_at || e.updated_at)}</span></td>
                        <td><span className={badgeClass(e.status)}>{statusLabel(e.status)}</span></td>
                        <td>
                          <span className="rating-cell">
                            {e.rating != null ? e.rating : '—'}<span>/10</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </>
        )}
      </div>

      {/* ── Right sidebar ── */}
      <div className="sidebar-right">
        <p className="panel-title">Summary</p>
        <div className="stat-grid">
          <div className="stat-box">
            <span className="stat-val">{totalCount ?? '—'}</span>
            <span className="stat-lbl">Total</span>
          </div>
          <div className="stat-box">
            <span className="stat-val">{avgRating ? avgRating.toFixed(1) : '—'}</span>
            <span className="stat-lbl">Avg Rating</span>
          </div>
          <div className="stat-box">
            <span className="stat-val">{activeCount}</span>
            <span className="stat-lbl">Active</span>
          </div>
          <div className="stat-box">
            <span className="stat-val">{plannedCount}</span>
            <span className="stat-lbl">Planned</span>
          </div>
        </div>

        {monthBars.length > 0 && (
          <>
            <p className="panel-title">Consumed / Month</p>
            <div className="chart-area">
              {monthBars.slice(-7).map((m, i) => (
                <div key={i} className="bar-col">
                  <div className="bar-fill"
                    style={{ height: `${Math.round((m.count / maxBar) * 100)}%` }} />
                  <span className="bar-label">{m.month ?? m.label ?? ''}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="panel-title" style={{ marginTop: 18 }}>Activity Log</p>
        {activity.length === 0
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
                    {a.type === 'completed' && a.entry.rating != null
                      ? ` — ${a.entry.rating}/10` : ''}
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
