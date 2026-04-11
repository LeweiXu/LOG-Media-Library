import { useState, useEffect, useMemo } from 'react';
import { getEntries, getStats } from '../api.jsx';
import { extractItems, usePageEntrance } from '../utils.jsx';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#4a9eff','#3ecf6a','#f5a623','#e05656','#a78bfa','#38bdf8','#fb923c'];

const STATUS_LABELS = {
  current: 'Current', planned: 'Planned', completed: 'Completed',
  on_hold: 'On Hold', dropped: 'Dropped',
};

function Tooltip_({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tt-label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="tt-val" style={{ color: p.color }}>{p.name}: {p.value}</div>
      ))}
    </div>
  );
}

function StatCard({ val, label, sub }) {
  return (
    <div className="stats-card">
      <span className="stats-card-val">{val ?? '—'}</span>
      <span className="stats-card-lbl">{label}</span>
      {sub && <span className="stats-card-sub">{sub}</span>}
    </div>
  );
}

function PieLegend({ data, colorOffset = 0 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {data.map((d, i) => (
        <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[(i + colorOffset) % COLORS.length], flexShrink: 0 }} />
          <span style={{ color: 'var(--text)' }}>{d.name}</span>
          <span style={{ color: 'var(--dim)', marginLeft: 'auto' }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

function deriveStats(entries) {
  if (!entries.length) return {};

  const completed = entries.filter(e => e.status === 'completed');
  const rated     = completed.filter(e => e.rating != null);
  const avgRating = rated.length
    ? rated.reduce((a, e) => a + e.rating, 0) / rated.length
    : null;

  const medMap = {};
  entries.forEach(e => { if (e.medium) medMap[e.medium] = (medMap[e.medium] || 0) + 1; });
  const by_medium = Object.entries(medMap).sort((a, b) => b[1] - a[1]).map(([medium, count]) => ({ medium, count }));

  const stMap = {};
  entries.forEach(e => { stMap[e.status] = (stMap[e.status] || 0) + 1; });
  const by_status = Object.entries(stMap).map(([status, count]) => ({ status, count }));

  const oriMap = {};
  entries.forEach(e => { if (e.origin) oriMap[e.origin] = (oriMap[e.origin] || 0) + 1; });
  const by_origin = Object.entries(oriMap).sort((a, b) => b[1] - a[1]).map(([origin, count]) => ({ origin, count }));

  // Rating distribution at 0.5 increments, only non-empty buckets
  const buckets = {};
  rated.forEach(e => {
    const r = Math.round(e.rating * 2) / 2;
    if (r >= 0.5 && r <= 10) buckets[r] = (buckets[r] || 0) + 1;
  });
  const rating_dist = Object.keys(buckets)
    .map(r => parseFloat(r))
    .sort((a, b) => a - b)
    .map(r => ({ rating: r, count: buckets[r] }));

  const monthMap = {};
  entries.forEach(e => {
    if (!e.completed_at) return;
    const d = new Date(e.completed_at);
    if (isNaN(d)) return;
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    if (!monthMap[key]) monthMap[key] = { key, label, count: 0 };
    monthMap[key].count++;
  });
  const entries_per_month = Object.values(monthMap).sort((a, b) => a.key.localeCompare(b.key));

  const yearMap = {};
  entries.forEach(e => { if (e.year) yearMap[e.year] = (yearMap[e.year] || 0) + 1; });
  const by_year = Object.entries(yearMap).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([year, count]) => ({ year, count }));

  const top_rated = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 10);

  return {
    total: entries.length, completed: completed.length, avg_rating: avgRating,
    by_medium, by_status, by_origin, rating_dist, entries_per_month, by_year, top_rated,
  };
}

const MONTH_INPUT_STYLE = {
  background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
  fontSize: 10, padding: '2px 6px', outline: 'none', fontFamily: 'inherit',
  textTransform: 'none', letterSpacing: 'normal', colorScheme: 'dark', cursor: 'pointer',
};

export default function Statistics() {
  const shouldAnimateOnEnter = usePageEntrance();
  const [apiStats,   setApiStats]   = useState(null);
  const [entries,    setEntries]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd,   setRangeEnd]   = useState('');
  const [barsReady,  setBarsReady]  = useState(false);
  const [pieAnimId,  setPieAnimId]  = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true); setError('');
      try {
        const [statsData, allEntries] = await Promise.all([
          getStats().catch(() => null),
          getEntries({ limit: 2000 }),
        ]);
        setEntries(extractItems(allEntries));
        setApiStats(statsData);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Animate CSS bars after data loads. The rAF ensures this fires in a new
  // macro-task so the cleanup+rerun from React StrictMode (dev) doesn't cancel it.
  useEffect(() => {
    if (!loading) {
      setBarsReady(false);
      const id = requestAnimationFrame(() => setBarsReady(true));
      return () => cancelAnimationFrame(id);
    }
  }, [loading]);

  // Recharts pie animations can get stuck after reloads/HMR in some dev flows.
  // Bumping animationId after data load forces a clean animation cycle.
  useEffect(() => {
    if (!loading) {
      const id = requestAnimationFrame(() => {
        setPieAnimId(prev => prev + 1);
      });
      return () => cancelAnimationFrame(id);
    }
  }, [loading, entries.length]);

  // Memoize expensive derivation so references stay stable across renders
  const derived = useMemo(() => deriveStats(entries), [entries]);
  const s = useMemo(
    () => ({ ...derived, ...(apiStats || {}), entries_per_month: derived.entries_per_month }),
    [derived, apiStats],
  );

  const allMonths = s.entries_per_month ?? [];

  // Compute the visible range directly in the render phase — no useEffect, no
  // extra state update — so filteredMonths is correct on the very first render
  // with data and never changes out from under a running recharts animation.
  const defaultStart = allMonths.length > 12 ? allMonths[allMonths.length - 12].key : allMonths[0]?.key ?? '';
  const defaultEnd   = allMonths[allMonths.length - 1]?.key ?? '';
  const effectiveStart = rangeStart || defaultStart;
  const effectiveEnd   = rangeEnd   || defaultEnd;

  const filteredMonths = useMemo(
    () => allMonths.filter(m => m.key >= effectiveStart && m.key <= effectiveEnd),
    [allMonths, effectiveStart, effectiveEnd],
  );

  const maxMedium = s.by_medium?.length ? Math.max(...s.by_medium.map(m => m.count), 1) : 1;
  const maxRating = s.rating_dist?.length ? Math.max(...s.rating_dist.map(r => r.count), 1) : 1;

  const statusPieData = useMemo(
    () => (s.by_status || []).map(({ status, count }) => ({ name: STATUS_LABELS[status] || status, value: count })),
    [s.by_status],
  );
  const originPieData = useMemo(
    () => (s.by_origin || []).slice(0, 6).map(({ origin, count }) => ({ name: origin, value: count })),
    [s.by_origin],
  );
  const enterClass = shouldAnimateOnEnter ? 'page-enter-active' : '';
  const enterStyle = (delay) => (
    shouldAnimateOnEnter ? { '--page-enter-delay': `${delay}ms` } : undefined
  );

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="stats-layout">

        <div className={`page-head ${enterClass}`} style={{ ...enterStyle(40), marginBottom: 24 }}>
          <div className="page-head-left">
            <span className="page-title">Statistics</span>
            <span className="page-desc">insights into your media habits</span>
          </div>
        </div>

        {error && (
          <div className="state-block">
            <div className="state-title">Connection Error</div>
            <div className="state-detail">{error}</div>
          </div>
        )}

        {loading && (
          <div className="state-block">
            <span className="loading-dots">Loading statistics</span>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Summary cards */}
            <div className={`stats-grid ${enterClass}`} style={enterStyle(85)}>
              <StatCard val={s.total}     label="Total Entries" />
              <StatCard val={s.completed} label="Completed" />
              <StatCard val={s.avg_rating != null ? s.avg_rating.toFixed(2) : '—'} label="Avg Rating" sub="rated entries" />
              <StatCard val={s.by_medium?.length} label="Media Types" />
            </div>

            {/* Entries per month */}
            {allMonths.length > 0 && (
              <div className={`chart-section ${enterClass}`} style={enterStyle(125)}>
                <div className="chart-section-title">
                  Consumed per Month
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', letterSpacing: 'normal' }}>
                    <input type="month" value={effectiveStart} min={allMonths[0]?.key} max={effectiveEnd}
                      onChange={e => setRangeStart(e.target.value)} style={MONTH_INPUT_STYLE} />
                    <span style={{ color: 'var(--dim)' }}>–</span>
                    <input type="month" value={effectiveEnd} min={effectiveStart} max={allMonths[allMonths.length - 1]?.key}
                      onChange={e => setRangeEnd(e.target.value)} style={MONTH_INPUT_STYLE} />
                  </span>
                </div>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={filteredMonths} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<Tooltip_ />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                      <Bar dataKey="count" fill="var(--accent)" opacity={0.7} radius={[2, 2, 0, 0]} name="Consumed" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className={`charts-2col ${enterClass}`} style={{ ...enterStyle(165), marginBottom: 28 }}>
              {/* By medium */}
              {s.by_medium?.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">By Medium</div>
                  {s.by_medium.map((m, i) => (
                    <div key={m.medium} className="h-bar-row">
                      <span className="lbl">{m.medium}</span>
                      <div className="bar-bg">
                        <div className="bar-v" style={{
                          width: barsReady ? `${Math.round((m.count / maxMedium) * 100)}%` : '0%',
                          background: COLORS[i % COLORS.length],
                        }} />
                      </div>
                      <span className="cnt">{m.count}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Rating distribution */}
              {s.rating_dist?.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">Rating Distribution</div>
                  {s.rating_dist.map(r => (
                    <div key={r.rating} className="rating-dist-row">
                      <span className="r-lbl">{r.rating}</span>
                      <div className="r-bar-bg">
                        <div className="r-bar-v" style={{ width: barsReady ? `${Math.round((r.count / maxRating) * 100)}%` : '0%' }} />
                      </div>
                      <span className="r-cnt">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`charts-2col ${enterClass}`} style={{ ...enterStyle(205), marginBottom: 28 }}>
              {/* Status pie */}
              {statusPieData.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">By Status</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <PieChart width={140} height={140}>
                      <Pie data={statusPieData} dataKey="value" cx="50%" cy="50%"
                        outerRadius={60} innerRadius={30} paddingAngle={2}
                        key={`status-pie-${pieAnimId}`}
                        animationId={pieAnimId}
                        isAnimationActive
                        animationBegin={40}
                        animationDuration={700}
                        animationEasing="ease-out">
                        {statusPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<Tooltip_ />} />
                    </PieChart>
                    <PieLegend data={statusPieData} colorOffset={0} />
                  </div>
                </div>
              )}

              {/* Origin pie */}
              {originPieData.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">By Origin</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <PieChart width={140} height={140}>
                      <Pie data={originPieData} dataKey="value" cx="50%" cy="50%"
                        outerRadius={60} innerRadius={30} paddingAngle={2}
                        key={`origin-pie-${pieAnimId}`}
                        animationId={pieAnimId + 1}
                        isAnimationActive
                        animationBegin={80}
                        animationDuration={750}
                        animationEasing="ease-out">
                        {originPieData.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<Tooltip_ />} />
                    </PieChart>
                    <PieLegend data={originPieData} colorOffset={2} />
                  </div>
                </div>
              )}
            </div>

            {/* Top rated */}
            {s.top_rated?.length > 0 && (
              <div className={`chart-section ${enterClass}`} style={enterStyle(245)}>
                <div className="chart-section-title">Top Rated</div>
                <div className="chart-box">
                  <table className="media-table">
                    <thead>
                      <tr><th>#</th><th>Title</th><th>Medium</th><th>Origin</th><th>Rating</th></tr>
                    </thead>
                    <tbody>
                      {s.top_rated.map((e, i) => (
                        <tr key={e.id}>
                          <td style={{ color: 'var(--dim)', width: 30 }}>{i + 1}</td>
                          <td><span className="media-name">{e.title}</span></td>
                          <td><span style={{ color: 'var(--dim)' }}>{e.medium}</span></td>
                          <td><span style={{ color: 'var(--dim)' }}>{e.origin}</span></td>
                          <td><span className="rating-cell">{e.rating}<span>/10</span></span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* By release year */}
            {s.by_year?.length > 0 && (
              <div className={`chart-section ${enterClass}`} style={enterStyle(285)}>
                <div className="chart-section-title">Entries by Release Year</div>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={s.by_year} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="year" tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip content={<Tooltip_ />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                      <Bar dataKey="count" fill="var(--green)" opacity={0.6} radius={[2, 2, 0, 0]} name="Entries" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
