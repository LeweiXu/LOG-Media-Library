import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getExplore, getSettings } from '../api.jsx';
import { MEDIUMS, statusLabel } from '../utils.jsx';
import { SkeletonExploreGrid } from './components/Skeletons.jsx';
import AddEntryModal from './components/AddEntryModal.jsx';

// 32-bit unsigned integer; backend re-seeds Python's RNG with it.
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

function mediumFromParam(raw) {
  if (raw == null) return undefined;
  const value = raw.trim();
  if (!value || value.toLowerCase() === 'all') return '';
  return MEDIUMS.find(m => m.toLowerCase() === value.toLowerCase()) ?? null;
}

export default function Explore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialUrlMedium = useRef(mediumFromParam(searchParams.get('medium')));
  const [items,        setItems]        = useState([]);
  const [affinity,     setAffinity]     = useState(null);
  const [personalised, setPersonalised] = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const exploreRequestSeq = useRef(0);

  // Settings seed the default medium; bias dimension lives in Settings.
  const [medium,       setMedium]       = useState(() => initialUrlMedium.current ?? '');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Per-card UI state — keyed by stable index because explore items have no DB id
  // until added. Tracks: 'idle' | 'adding' | 'added:<status>' | 'error:<msg>'
  const [cardState, setCardState] = useState({});
  const [pendingAdd, setPendingAdd] = useState(null);
  // Bumped on every Refresh — also flips refreshFlag so the next fetch
  // bypasses the server-side per-medium cache.
  const [seed, setSeed] = useState(() => newSeed());
  const [refreshFlag, setRefreshFlag] = useState(false);
  // Mobile drawer state — '', 'left', or 'right'.
  const [drawer, setDrawer] = useState('');

  // ── Initial load: pull saved settings, seed filters from them ────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        if (initialUrlMedium.current === undefined) {
          setMedium(s.explore_default_medium || '');
        }
      } catch {
        /* fall back to defaults */
      } finally {
        if (!cancelled) setSettingsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (medium) {
        next.set('medium', medium);
      } else {
        next.delete('medium');
      }
      return next;
    }, { replace: true });
  }, [medium, settingsLoaded, setSearchParams]);

  useEffect(() => {
    const urlMedium = mediumFromParam(searchParams.get('medium'));
    if (urlMedium === null) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('medium');
        return next;
      }, { replace: true });
      setMedium(prev => prev === '' ? prev : '');
      return;
    }
    const nextMedium = urlMedium ?? '';
    setMedium(prev => prev === nextMedium ? prev : nextMedium);
  }, [searchParams, setSearchParams]);

  // ── Fetch explore data whenever filters or seed change ──────────────────
  const fetchExplore = useCallback(async () => {
    const requestSeq = ++exploreRequestSeq.current;
    setLoading(true); setError(''); setCardState({});
    try {
      const data = await getExplore({
        medium, limit: 30, seed,
        refresh: refreshFlag,
      });
      if (requestSeq !== exploreRequestSeq.current) return;
      setItems(data.items || []);
      setAffinity(data.affinity || null);
      setPersonalised(!!data.personalised);
    } catch (e) {
      if (requestSeq !== exploreRequestSeq.current) return;
      setError(e.message);
    } finally {
      if (requestSeq !== exploreRequestSeq.current) return;
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

  function entryFromExploreItem(item, statusValue) {
    return {
      title:           item.title           || '',
      medium:          item.medium          || '',
      origin:          item.origin          || '',
      status:          statusValue,
      year:            item.year            || '',
      rating:          '',
      progress:        statusValue === 'completed' && item.total ? item.total : '',
      total:           item.total           || '',
      cover_url:       item.cover_url       || '',
      notes:           '',
      external_id:     item.external_id     || '',
      source:          item.source          || '',
      external_url:    item.external_url    || '',
      genres:          item.genres          || '',
      external_rating: item.external_rating ?? '',
    };
  }

  function openAddModal(idx, item, statusValue) {
    setPendingAdd({
      idx,
      status: statusValue,
      entry: entryFromExploreItem(item, statusValue),
    });
  }

  function handleCardClick(idx, item, owned) {
    if (owned) return;
    openAddModal(idx, item, 'planned');
  }

  function handleCardKeyDown(e, idx, item, owned) {
    if (owned) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openAddModal(idx, item, 'planned');
    }
  }

  function handleEntryCreated(created) {
    if (!pendingAdd) return;
    setCardState(s => ({ ...s, [pendingAdd.idx]: `added:${created?.status || pendingAdd.status}` }));
    setPendingAdd(null);
  }

  return (
    <div className="layout-3col" data-drawer={drawer}>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer('')} aria-hidden="true" />
      )}
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
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'left' ? '' : 'left')}
              aria-label="Toggle medium filter"
              title="Medium"
            >☰ Medium</button>
            <span className="page-title">Explore</span>
            <span className="page-desc">
              {loading ? <span className="loading-dots">scanning</span>
                       : `${items.length} suggestions${personalised ? ' · tuned to your taste' : ''}`}
            </span>
          </div>
          <div className="page-head-mobile">
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'right' ? '' : 'right')}
              aria-label="Toggle taste profile"
              title="Taste"
            >⋯</button>
            <button className="icon-btn" onClick={handleRefresh} disabled={loading}
              title="Refresh" style={{ padding: '5px 10px' }}>
              Refresh
            </button>
          </div>
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
            const hasMatches = personalised && item.matches && item.matches.length > 0;

            return (
              <article key={`${item.source}:${item.external_id || item.title}:${idx}`}
                       className={'explore-card' + (owned ? ' is-owned' : '')}
                       role={owned ? undefined : 'button'}
                       tabIndex={owned ? undefined : 0}
                       onClick={() => handleCardClick(idx, item, owned)}
                       onKeyDown={e => handleCardKeyDown(e, idx, item, owned)}>
                <div className="explore-cover">
                  {item.cover_url
                    ? <img src={item.cover_url} alt="" loading="lazy" />
                    : <div className="explore-cover-empty">—</div>}
                </div>

                <div className="explore-body">
                  <div className="explore-title-row">
                    {item.external_url
                      ? <a href={item.external_url} target="_blank" rel="noopener noreferrer"
                           onClick={e => e.stopPropagation()}
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

                  {hasMatches && (
                    <div className="explore-match" title="Genres, origin, or medium you consume most in your library">
                      matches: {item.matches.join(', ')}
                    </div>
                  )}

                  {item.description && (
                    <p className={'explore-desc' + (!hasMatches ? ' no-match' : '')}>{item.description}</p>
                  )}

                  {isError && <div className="explore-err">{errMsg}</div>}
                </div>

                {owned && (
                  <div className={'explore-card-overlay explore-card-added-overlay' + (addedAs ? ` status-${addedAs}` : '')}>
                    <span>{addedAs ? `✓ added · ${statusLabel(addedAs)}` : '✓ in library'}</span>
                  </div>
                )}
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

      {pendingAdd && (
        <AddEntryModal
          initialTab="manual"
          initialEntry={pendingAdd.entry}
          hideTabs
          onClose={() => setPendingAdd(null)}
          onCreated={handleEntryCreated}
        />
      )}
    </div>
  );
}
