import { useEffect, useMemo, useState } from 'react';
import { getStats } from '../api.jsx';
import { SkeletonChartBox, SkeletonLine } from './components/Skeletons.jsx';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const COLORS = ['#4a9eff', '#3ecf6a', '#f5a623', '#e05656', '#a78bfa', '#38bdf8', '#fb923c'];

const STATUS_LABELS = {
  current: 'Current',
  planned: 'Planned',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
};

const CONSUMED_RANGE_KEY = 'statistics_consumed_range';
const ADDED_RANGE_KEY = 'statistics_added_range';

const MONTH_INPUT_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 10,
  padding: '2px 6px',
  outline: 'none',
  fontFamily: 'inherit',
  textTransform: 'none',
  letterSpacing: 'normal',
  colorScheme: 'dark',
  cursor: 'pointer',
};

function monthParam(value) {
  return /^\d{4}-\d{2}$/.test(value || '') ? value : '';
}

function loadStoredRange(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key));
    return {
      start: monthParam(value?.start),
      end: monthParam(value?.end),
    };
  } catch {
    return { start: '', end: '' };
  }
}

function storeRange(key, start, end) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ start, end }));
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

function resolveRange(range, defaultStart, minimum, maximum) {
  if (!minimum || !maximum) return { start: '', end: '' };

  const requestedStart = range.start || defaultStart;
  const requestedEnd = range.end || maximum;
  const start = requestedStart < minimum
    ? minimum
    : requestedStart > maximum ? maximum : requestedStart;
  const end = requestedEnd < minimum
    ? minimum
    : requestedEnd > maximum ? maximum : requestedEnd;

  return start <= end ? { start, end } : { start: end, end };
}

function Tooltip_({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="tt-label">{label}</div>
      {payload.map((item, index) => (
        <div key={index} className="tt-val" style={{ color: item.color }}>
          {item.name}: {item.value}
        </div>
      ))}
    </div>
  );
}

function StatCard({ value, label, sub }) {
  return (
    <div className="stats-card">
      <span className="stats-card-val">{value ?? '—'}</span>
      <span className="stats-card-lbl">{label}</span>
      {sub && <span className="stats-card-sub">{sub}</span>}
    </div>
  );
}

function PieLegend({ data, colorOffset = 0 }) {
  return (
    <div className="stats-pie-legend">
      {data.map((item, index) => (
        <div key={item.name} className="stats-pie-legend-row">
          <span
            className="stats-pie-swatch"
            style={{ background: COLORS[(index + colorOffset) % COLORS.length] }}
          />
          <span>{item.name}</span>
          <span className="stats-pie-leader" aria-hidden="true" />
          <span className="stats-pie-count">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function StatisticsSkeleton() {
  return (
    <div className="skeleton-page" aria-label="Loading statistics">
      <div className="stats-grid">
        {[
          'Total Entries', 'Completed', 'Current', 'Planned',
          'Completion Rate', 'Avg Rating', 'Rating Coverage', 'Avg Rating',
        ].map((label, index) => (
          <div key={`${label}-${index}`} className="stats-card">
            <SkeletonLine width={64} height={28} />
            <span className="stats-card-lbl">{label}</span>
          </div>
        ))}
      </div>
      <div className="chart-section">
        <div className="chart-section-title">Consumed per Month</div>
        <SkeletonChartBox variant="plot" />
      </div>
      <div className="chart-section">
        <div className="chart-section-title">Added per Month</div>
        <SkeletonChartBox variant="plot" />
      </div>
      <div className="charts-2col" style={{ marginBottom: 28 }}>
        <SkeletonChartBox rows={7} />
        <SkeletonChartBox rows={7} />
      </div>
      <div className="charts-2col" style={{ marginBottom: 28 }}>
        <SkeletonChartBox rows={7} />
        <SkeletonChartBox rows={7} />
      </div>
      <div className="chart-section">
        <div className="chart-section-title">Release Year Profile</div>
        <SkeletonChartBox variant="plot" />
      </div>
    </div>
  );
}

export default function Statistics() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [consumedRange, setConsumedRange] = useState(() => loadStoredRange(CONSUMED_RANGE_KEY));
  const [addedRange, setAddedRange] = useState(() => loadStoredRange(ADDED_RANGE_KEY));
  const [barsReady, setBarsReady] = useState(false);
  const [pieAnimId, setPieAnimId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getStats();
        if (!cancelled) setStats(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading) return;
    setBarsReady(false);
    const id = requestAnimationFrame(() => {
      setBarsReady(true);
      setPieAnimId(value => value + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [loading]);

  const activity = stats?.activity_per_month ?? [];
  const activityStart = activity[0]?.key ?? '';
  const activityEnd = activity[activity.length - 1]?.key ?? '';
  const defaultConsumedStart = activity.length > 12 ? activity[activity.length - 12].key : activityStart;
  const defaultAddedStart = activity.length > 5 ? activity[activity.length - 5].key : activityStart;
  const { start: consumedStart, end: consumedEnd } = resolveRange(
    consumedRange,
    defaultConsumedStart,
    activityStart,
    activityEnd,
  );
  const { start: addedStart, end: addedEnd } = resolveRange(
    addedRange,
    defaultAddedStart,
    activityStart,
    activityEnd,
  );
  const consumedActivity = useMemo(
    () => activity.filter(item => item.key >= consumedStart && item.key <= consumedEnd),
    [activity, consumedEnd, consumedStart],
  );
  const addedActivity = useMemo(
    () => activity.filter(item => item.key >= addedStart && item.key <= addedEnd),
    [activity, addedEnd, addedStart],
  );

  useEffect(() => {
    if (!activity.length) return;
    storeRange(CONSUMED_RANGE_KEY, consumedStart, consumedEnd);
  }, [activity.length, consumedEnd, consumedStart]);

  useEffect(() => {
    if (!activity.length) return;
    storeRange(ADDED_RANGE_KEY, addedStart, addedEnd);
  }, [activity.length, addedEnd, addedStart]);

  const statusPieData = useMemo(() => {
    if (!stats) return [];
    return ['current', 'planned', 'completed', 'on_hold', 'dropped']
      .map(status => ({ name: STATUS_LABELS[status], value: stats[status] || 0 }))
      .filter(item => item.value > 0);
  }, [stats]);

  const originPieData = useMemo(
    () => (stats?.by_origin || []).slice(0, 6).map(item => ({
      name: item.origin,
      value: item.count,
    })),
    [stats],
  );

  const maxCompletionTotal = Math.max(
    ...(stats?.completion_by_medium || []).map(item => item.total),
    1,
  );
  const maxMedium = Math.max(...(stats?.by_medium || []).map(item => item.count), 1);
  const maxBacklog = Math.max(...(stats?.backlog_age || []).map(item => item.count), 1);
  const maxRatingBucket = Math.max(
    ...(stats?.rating_distribution || []).map(item => item.count),
    1,
  );

  return (
    <div className="statistics-page">
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

        {loading && <StatisticsSkeleton />}

        {!loading && !error && stats && (
          <>
            <div className="stats-grid">
              <StatCard value={stats.total} label="Total Entries" />
              <StatCard value={stats.completed} label="Completed" />
              <StatCard value={stats.current} label="Current" />
              <StatCard value={stats.planned} label="Planned" />
              <StatCard value={`${stats.completion_rate.toFixed(1)}%`} label="Completion Rate" />
              <StatCard
                value={stats.avg_rating != null ? stats.avg_rating.toFixed(2) : '—'}
                label="Avg Rating"
                sub="completed entries"
              />
              <StatCard
                value={`${stats.rating_coverage.toFixed(1)}%`}
                label="Rating Coverage"
                sub="completed entries rated"
              />
              <StatCard
                value={stats.avg_rating_all != null ? stats.avg_rating_all.toFixed(2) : '—'}
                label="Avg Rating"
                sub="all entries"
              />
            </div>

            {activity.length > 0 && (
              <>
                <div className="chart-section">
                  <div className="chart-section-title">
                    Consumed per Month
                    <span className="stats-range-controls">
                      <input
                        type="month"
                        value={consumedStart}
                        min={activityStart}
                        max={consumedEnd}
                        onChange={event => setConsumedRange(range => ({
                          ...range,
                          start: event.target.value,
                        }))}
                        style={MONTH_INPUT_STYLE}
                      />
                      <span>to</span>
                      <input
                        type="month"
                        value={consumedEnd}
                        min={consumedStart}
                        max={activityEnd}
                        onChange={event => setConsumedRange(range => ({
                          ...range,
                          end: event.target.value,
                        }))}
                        style={MONTH_INPUT_STYLE}
                      />
                    </span>
                  </div>
                  <div className="chart-box">
                    <div className="chart-canvas chart-canvas-activity">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={consumedActivity} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                          <CartesianGrid vertical={false} stroke="var(--border)" />
                          <XAxis dataKey="label" tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip content={<Tooltip_ />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                          <Bar dataKey="completed" name="Consumed" fill="var(--accent)" opacity={0.72} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="chart-section">
                  <div className="chart-section-title">
                    Added per Month
                    <span className="stats-range-controls">
                      <input
                        type="month"
                        value={addedStart}
                        min={activityStart}
                        max={addedEnd}
                        onChange={event => setAddedRange(range => ({
                          ...range,
                          start: event.target.value,
                        }))}
                        style={MONTH_INPUT_STYLE}
                      />
                      <span>to</span>
                      <input
                        type="month"
                        value={addedEnd}
                        min={addedStart}
                        max={activityEnd}
                        onChange={event => setAddedRange(range => ({
                          ...range,
                          end: event.target.value,
                        }))}
                        style={MONTH_INPUT_STYLE}
                      />
                    </span>
                  </div>
                  <div className="chart-box">
                    <div className="chart-canvas chart-canvas-activity">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={addedActivity} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                          <CartesianGrid vertical={false} stroke="var(--border)" />
                          <XAxis dataKey="label" tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: 'var(--dim)', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip content={<Tooltip_ />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                          <Bar dataKey="added" name="Added" fill="var(--green)" opacity={0.72} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="charts-2col stats-section-gap">
              <div className="chart-box">
                <div className="chart-box-title">By Medium</div>
                {(stats.by_medium || []).map((item, index) => (
                  <div key={item.medium} className="h-bar-row">
                    <span className="lbl">{item.medium}</span>
                    <div className="bar-bg">
                      <div
                        className="bar-v"
                        style={{
                          width: barsReady ? `${item.count / maxMedium * 100}%` : '0%',
                          background: COLORS[index % COLORS.length],
                        }}
                      />
                    </div>
                    <span className="cnt">{item.count}</span>
                  </div>
                ))}
              </div>

              <div className="chart-box">
                <div className="chart-box-title">Completion by Medium</div>
                {(stats.completion_by_medium || []).map(item => (
                  <div key={item.medium} className="stats-completion-row">
                    <span className="lbl">{item.medium}</span>
                    <div className="bar-bg">
                      <div
                        className="bar-v"
                        style={{
                          width: barsReady ? `${item.rate}%` : '0%',
                          opacity: 0.5 + (item.total / maxCompletionTotal) * 0.5,
                        }}
                      />
                    </div>
                    <span className="cnt">{item.completed}/{item.total}</span>
                    <span className="pct">{item.rate.toFixed(0)}%</span>
                  </div>
                ))}
              </div>

            </div>

            <div className="charts-2col stats-section-gap">
              <div className="chart-box">
                <div className="chart-box-title">Backlog Health</div>
                {(stats.backlog_age || []).map(item => (
                  <div key={item.key} className="h-bar-row">
                    <span className="lbl">{item.label}</span>
                    <div className="bar-bg">
                      <div
                        className="bar-v stats-backlog-bar"
                        style={{ width: barsReady ? `${item.count / maxBacklog * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="cnt">{item.count}</span>
                  </div>
                ))}
                <div className="stats-fact-grid">
                  <div>
                    <span className="stats-fact-value">
                      {stats.average_active_progress != null ? `${stats.average_active_progress.toFixed(0)}%` : '—'}
                    </span>
                    <span className="stats-fact-label">active progress</span>
                  </div>
                  <div>
                    <span className="stats-fact-value">{stats.current_completion_streak}</span>
                    <span className="stats-fact-label">month streak</span>
                  </div>
                  <div>
                    <span className="stats-fact-value">{stats.longest_completion_streak}</span>
                    <span className="stats-fact-label">best streak</span>
                  </div>
                </div>
              </div>

              <div className="chart-box">
                <div className="chart-box-title">Rating Distribution</div>
                {(stats.rating_distribution || []).map(item => (
                  <div key={item.rating} className="rating-dist-row">
                    <span className="r-lbl">{item.rating}</span>
                    <div className="r-bar-bg">
                      <div
                        className="r-bar-v"
                        style={{ width: barsReady ? `${item.count / maxRatingBucket * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="r-cnt">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="chart-section">
              <div className="chart-section-title">Rating Comparison</div>
              <div className="chart-box">
                <div className="chart-box-title">Personal vs External Rating</div>
                <div className="stats-rating-head">
                  <span>Medium</span><span>You</span><span>External</span><span>Delta</span>
                </div>
                {(stats.rating_comparison_by_medium || []).map(item => (
                  <div key={item.medium} className="stats-rating-row">
                    <span>{item.medium}<small>{item.matched} matched</small></span>
                    <span>{item.personal.toFixed(2)}</span>
                    <span>{item.external.toFixed(2)}</span>
                    <span className={item.difference >= 0 ? 'is-positive' : 'is-negative'}>
                      {item.difference >= 0 ? '+' : ''}{item.difference.toFixed(2)}
                    </span>
                  </div>
                ))}
                {stats.rating_comparison_by_medium?.length === 0 && (
                  <div className="stats-empty">No entries have both personal and external ratings.</div>
                )}
              </div>
            </div>

            <div className="charts-2col stats-section-gap">
              {statusPieData.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">By Status</div>
                  <div className="stats-pie-layout">
                    <PieChart width={140} height={140}>
                      <Pie
                        data={statusPieData}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        outerRadius={60}
                        innerRadius={30}
                        paddingAngle={2}
                        key={`status-${pieAnimId}`}
                        animationId={pieAnimId}
                        animationDuration={700}
                      >
                        {statusPieData.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}
                      </Pie>
                      <Tooltip content={<Tooltip_ />} />
                    </PieChart>
                    <PieLegend data={statusPieData} />
                  </div>
                </div>
              )}

              {originPieData.length > 0 && (
                <div className="chart-box">
                  <div className="chart-box-title">By Origin</div>
                  <div className="stats-pie-layout">
                    <PieChart width={140} height={140}>
                      <Pie
                        data={originPieData}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        outerRadius={60}
                        innerRadius={30}
                        paddingAngle={2}
                        key={`origin-${pieAnimId}`}
                        animationId={pieAnimId + 1}
                        animationDuration={750}
                      >
                        {originPieData.map((_, index) => (
                          <Cell key={index} fill={COLORS[(index + 2) % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<Tooltip_ />} />
                    </PieChart>
                    <PieLegend data={originPieData} colorOffset={2} />
                  </div>
                </div>
              )}
            </div>

            {stats.release_years?.length > 0 && (
              <div className="chart-section">
                <div className="chart-section-title">Release Year Profile</div>
                <div className="chart-box">
                  <div className="chart-canvas chart-canvas-release-year">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={stats.release_years} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
                        <CartesianGrid vertical={false} stroke="var(--border)" />
                        <XAxis
                          dataKey="year"
                          tick={{ fill: 'var(--dim)', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          minTickGap={18}
                        />
                        <YAxis
                          yAxisId="count"
                          tick={{ fill: 'var(--dim)', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                          allowDecimals={false}
                        />
                        <YAxis
                          yAxisId="rating"
                          orientation="right"
                          domain={[0, 10]}
                          tick={{ fill: 'var(--dim)', fontSize: 10 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip content={<Tooltip_ />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                        <Bar yAxisId="count" dataKey="count" name="Entries" fill="var(--accent)" opacity={0.55} />
                        <Line
                          yAxisId="rating"
                          dataKey="avg_rating"
                          name="Avg rating"
                          stroke="var(--amber)"
                          strokeWidth={2}
                          connectNulls
                          dot={{ r: 2, fill: 'var(--amber)', strokeWidth: 0 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
