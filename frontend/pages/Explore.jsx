import { useState, useEffect, useCallback } from 'react';
import { getExplore, getSettings, createEntry } from '../api.jsx';
import { MEDIUMS } from '../utils.jsx';
import { SkeletonExploreGrid } from './components/Skeletons.jsx';

const QUICK_STATUSES = [
  { value: 'planned',   label: '+ Planned',   hint: 'Add to your plan list' },
  { value: 'current',   label: '+ Current',   hint: 'Mark as currently consuming' },
  { value: 'completed', label: '+ Completed', hint: 'Mark as already completed' },
];

// 32-bit unsigned integer; backend re-seeds Python's RNG with it.
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

export default function Explore() {
  const [items,        setItems]        = useState([]);
  const [affinity,     setAffinity]     = useState(null);
  const [personalised, setPersonalised] = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');

  // Settings seed the default medium; bias dimension lives in Settings.
  const [medium,       setMedium]       = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Per-card UI state — keyed by stable index because explore items have no DB id
  // until added. Tracks: 'idle' | 'adding' | 'added:<status>' | 'error:<msg>'
  const [cardState, setCardState] = useState({});
  // Bumped on every Refresh — also flips refreshFlag so the next fetch
  // bypasses the server-side per-medium cache.
  const [seed, setSeed] = useState(() => newSeed());
  const [refreshFlag, setRefreshFlag] = useState(false);

  // ── Initial load: pull saved settings, seed filters from them ────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        setMedium(s.explore_default_medium || '');
      } catch {
        /* fall back to defaults */
      } finally {
        if (!cancelled) setSettingsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch explore data whenever filters or seed change ──────────────────
  const fetchExplore = useCallback(async () => {
    setLoading(true); setError(''); setCardState({});
    try {
      const data = await getExplore({
        medium, limit: 30, seed,
        refresh: refreshFlag,
      });
      setItems(data.items || []);
      setAffinity(data.affinity || null);
      setPersonalised(!!data.personalised);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshFlag(false);
    }
  }, [medium, seed, refreshFlag]);

  useEffect(() => {
    if (!settingsLoaded) return;
    fetchExplore();
  }, [fetchExplore, settingsLoaded]);

  // Refresh = bypass server cache + new shuffle seed.
  const handleRefresh = () => {
    setRefreshFlag(true);
    setSeed(newSeed());
  };

  async function quickAdd(idx, item, statusValue) {
    setCardState(s => ({ ...s, [idx]: 'adding' }));
    try {
      await createEntry({
        title:           item.title,
        medium:          item.medium || null,
        origin:          item.origin || null,
        year:            item.year ?? null,
        cover_url:       item.cover_url || null,
        external_id:     item.external_id || null,
        source:          item.source || null,
        external_url:    item.external_url || null,
        genres:          item.genres || null,
        external_rating: item.external_rating ?? null,
        status:          statusValue,
      });
      setCardState(s => ({ ...s, [idx]: `added:${statusValue}` }));
    } catch (e) {
      setCardState(s => ({ ...s, [idx]: `error:${e.message}` }));
    }
  }

  return (
    <div className="layout-3col">
      {/* ── Left sidebar: local medium filter ───────────────────────────── */}
      <aside className="sidebar-left">
        <div className="sidebar-section">
          <span className="sidebar-label">Medium</span>
          <div
            className={'sidebar-item' + (medium === '' ? ' active' : '')}
            onClick={() => setMedium('')}
          >
            <span>All</span>
          </div>
          {MEDIUMS.map(m => (
            <div
              key={m}
              className={'sidebar-item' + (medium === m ? ' active' : '')}
              onClick={() => setMedium(m)}
            >
              <span>{m}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Main content: card grid ─────────────────────────────────────── */}
      <main className="main-content">
        <div className="page-head">
          <div className="page-head-left">
            <span className="page-title">Explore</span>
            <span className="page-desc">
              {loading ? <span className="loading-dots">scanning</span>
                       : `${items.length} suggestions${personalised ? ' · tuned to your taste' : ''}`}
            </span>
          </div>
          <button className="icon-btn" onClick={handleRefresh} disabled={loading}
            title="Refresh" style={{ padding: '5px 10px' }}>
            Refresh
          </button>
        </div>

        {error && (
          <div className="state-block">
            <div className="state-title">Error</div>
            <div className="state-detail">{error}</div>
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={handleRefresh}>Retry</button>
          </div>
        )}

        {!error && loading && (
          <div className="skeleton-page" aria-label="Loading explore">
            <SkeletonExploreGrid cards={9} />
          </div>
        )}

        {!error && !loading && items.length === 0 && (
          <div className="state-block">
            <div className="state-title">No suggestions to surface.</div>
            <div className="state-detail">
              Try a different medium, or rate a few entries to teach the recommender.
            </div>
          </div>
        )}

        {!error && !loading && items.length > 0 && (
        <div className="explore-grid">
          {items.map((item, idx) => {
            const state = cardState[idx] || 'idle';
            const isAdded = state.startsWith('added:');
            const isError = state.startsWith('error:');
            const errMsg  = isError ? state.slice('error:'.length) : '';
            const addedAs = isAdded ? state.slice('added:'.length) : '';
            const owned   = item.in_library || isAdded;

            return (
              <article key={`${item.source}:${item.external_id || item.title}:${idx}`}
                       className={'explore-card' + (owned ? ' is-owned' : '')}>
                <div className="explore-cover">
                  {item.cover_url
                    ? <img src={item.cover_url} alt="" loading="lazy" />
                    : <div className="explore-cover-empty">—</div>}
                </div>

                <div className="explore-body">
                  <div className="explore-title-row">
                    {item.external_url
                      ? <a href={item.external_url} target="_blank" rel="noopener noreferrer"
                           className="explore-title">{item.title}</a>
                      : <span className="explore-title">{item.title}</span>}
                  </div>

                  <div className="explore-meta">
                    {item.medium && <span>{item.medium}</span>}
                    {item.year   && <span> · {item.year}</span>}
                    {item.origin && <span> · {item.origin}</span>}
                    {item.external_rating != null && <span> · </span>}
                    {item.external_rating != null && (
                      <span className="explore-meta-rating">★ {item.external_rating.toFixed(1)}</span>
                    )}
                  </div>

                  {personalised && item.matches && item.matches.length > 0 && (
                    <div className="explore-match" title="Genres, origin, or medium you consume most in your library">
                      matches: {item.matches.join(', ')}
                    </div>
                  )}

                  {item.description && (
                    <p className="explore-desc">{item.description}</p>
                  )}

                  <div className="explore-actions">
                    {owned ? (
                      <span className="explore-owned-tag">
                        {addedAs ? `✓ added · ${addedAs}` : '✓ in library'}
                      </span>
                    ) : (
                      <>
                        {QUICK_STATUSES.map(qs => (
                          <button
                            key={qs.value}
                            className="icon-btn"
                            disabled={state === 'adding'}
                            onClick={() => quickAdd(idx, item, qs.value)}
                            title={qs.hint}
                          >
                            {qs.label}
                          </button>
                        ))}
                      </>
                    )}
                  </div>

                  {isError && <div className="explore-err">{errMsg}</div>}
                </div>
              </article>
            );
          })}
        </div>
        )}
      </main>

      {/* ── Right sidebar: affinity snapshot ─────────────────────────────── */}
      <aside className="sidebar-right">
        <div className="panel-title">Your library</div>
        {!affinity || affinity.sample_size === 0 ? (
          <p className="explore-affinity-empty">
            Add a few entries to your library to bias what shows up here.
          </p>
        ) : (
          <>
            <div className="explore-affinity-meta">
              {affinity.sample_size} entries · {personalised ? 'bias on' : 'bias off'}
            </div>

            {affinity.top_genres.length > 0 && (
              <div className="explore-affinity-block">
                <div className="explore-affinity-label">Top genres</div>
                <div className="explore-tag-list">
                  {affinity.top_genres.map(g => (
                    <span key={g} className="explore-tag">{g}</span>
                  ))}
                </div>
              </div>
            )}

            {affinity.top_origins.length > 0 && (
              <div className="explore-affinity-block">
                <div className="explore-affinity-label">Top origins</div>
                <div className="explore-tag-list">
                  {affinity.top_origins.map(o => (
                    <span key={o} className="explore-tag">{o}</span>
                  ))}
                </div>
              </div>
            )}

            {affinity.top_mediums.length > 0 && (
              <div className="explore-affinity-block">
                <div className="explore-affinity-label">Top mediums</div>
                <div className="explore-tag-list">
                  {affinity.top_mediums.map(m => (
                    <span key={m} className="explore-tag">{m}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="explore-affinity-note">
              Ranking nudges results toward your most-consumed genres, origins,
              and mediums. Change the bias dimension in Settings → Explore.
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
