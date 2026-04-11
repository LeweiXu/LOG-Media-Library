import { useState, useEffect } from 'react';
import { getEntries, getStats } from '../api.jsx';
import { extractItems } from '../utils.jsx';
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

  // By medium
  const medMap = {};
  entries.forEach(e => { if (e.medium) medMap[e.medium] = (medMap[e.medium] || 0) + 1; });
  const by_medium = Object.entries(medMap).sort((a, b) => b[1] - a[1]).map(([medium, count]) => ({ medium, count }));

  // By status
  const stMap = {};
  entries.forEach(e => { stMap[e.status] = (stMap[e.status] || 0) + 1; });
  const by_status = Object.entries(stMap).map(([status, count]) => ({ status, count }));

  // By origin
  const oriMap = {};
  entries.forEach(e => { if (e.origin) oriMap[e.origin] = (oriMap[e.origin] || 0) + 1; });
  const by_origin = Object.entries(oriMap).sort((a, b) => b[1] - a[1]).map(([origin, count]) => ({ origin, count }));

  // Rating distribution
  const buckets = {};
  for (let i = 1; i <= 10; i++) buckets[i] = 0;
  rated.forEach(e => { const r = Math.round(e.rating); if (r >= 1 && r <= 10) buckets[r]++; });
  const rating_dist = Object.entries(buckets).map(([r, count]) => ({ rating: parseInt(r), count }));

  // Consumed per month (completed entries only, based on completed_at)
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
  const entries_per_month = Object.values(monthMap).sort((a, b) => a.key.localeCompare(b.key)).slice(-12);

  // By year
  const yearMap = {};
  entries.forEach(e => { if (e.year) yearMap[e.year] = (yearMap[e.year] || 0) + 1; });
  const by_year = Object.entries(yearMap).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).map(([year, count]) => ({ year, count }));

  // Top rated
  const top_rated = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 10);

  return {
    total: entries.length,
    completed: completed.length,
    avg_rating: avgRating,
    by_medium,
    by_status,
    by_origin,
    rating_dist,
    entries_per_month,
    by_year,
    top_rated,
  };
}

export default function Statistics() {
  const [apiStats, setApiStats]   = useState(null);
  const [entries,  setEntries]    = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState('');

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

  // Merge derived stats with API stats (API wins on overlap)
  const s = { ...deriveStats(entries), ...(apiStats || {}) };

  const maxMedium = s.by_medium?.length ? Math.max(...s.by_medium.map(m => m.count), 1) : 1;
  const maxRating = s.rating_dist?.length ? Math.max(...s.rating_dist.map(r => r.count), 1) : 1;

  const statusPieData = (s.by_status || []).map(({ status, count }) => ({
    name: STATUS_LABELS[status] || status, value: count,
  }));

  const originPieData = (s.by_origin || []).slice(0, 6).map(({ origin, count }) => ({
    name: origin, value: count,
  }));

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="stats-layout">

        <div className="page-head" style={{ marginBottom: 24 }}>
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
            <div className="stats-grid">
              <StatCard val={s.total}     label="Total Entries" />
              <StatCard val={s.completed} label="Completed" />
              <StatCard val={s.avg_rating != null ? s.avg_rating.toFixed(2) : '—'} label="Avg Rating" sub="rated entries" />
              <StatCard val={s.by_medium?.length} label="Media Types" />
            </div>

            {/* Entries per month */}
            {s.entries_per_month?.length > 0 && (
              <div className="chart-section">
                <div className="chart-section-title">Consumed per Month</div>
                <div className="chart-box">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={s.entries_per_month} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
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

            <div className="charts-2col" style={{ marginBottom: 28 }}>
              {/* By medium */}
              {s.by_medium?.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">By Medium</div>
                  {s.by_medium.map((m, i) => (
                    <div key={m.medium} className="h-bar-row">
                      <span className="lbl">{m.medium}</span>
                      <div className="bar-bg">
                        <div className="bar-v" style={{
                          width: `${Math.round((m.count / maxMedium) * 100)}%`,
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
                  {s.rating_dist.filter(r => r.count > 0 || r.rating >= 5).map(r => (
                    <div key={r.rating} className="rating-dist-row">
                      <span className="r-lbl">{r.rating}</span>
                      <div className="r-bar-bg">
                        <div className="r-bar-v" style={{ width: `${Math.round((r.count / maxRating) * 100)}%` }} />
                      </div>
                      <span className="r-cnt">{r.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="charts-2col" style={{ marginBottom: 28 }}>
              {/* Status pie */}
              {statusPieData.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">By Status</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart>
                        <Pie data={statusPieData} dataKey="value" cx="50%" cy="50%"
                          outerRadius={60} innerRadius={30} paddingAngle={2}>
                          {statusPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip content={<Tooltip_ />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <PieLegend data={statusPieData} colorOffset={0} />
                  </div>
                </div>
              )}

              {/* Origin pie */}
              {originPieData.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">By Origin</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart>
                        <Pie data={originPieData} dataKey="value" cx="50%" cy="50%"
                          outerRadius={60} innerRadius={30} paddingAngle={2}>
                          {originPieData.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
                        </Pie>
                        <Tooltip content={<Tooltip_ />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <PieLegend data={originPieData} colorOffset={2} />
                  </div>
                </div>
              )}
            </div>

            {/* Top rated */}
            {s.top_rated?.length > 0 && (
              <div className="chart-section">
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
              <div className="chart-section">
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