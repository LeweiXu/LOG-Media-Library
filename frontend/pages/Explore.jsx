import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getExplore } from '../api.jsx';
import { MEDIUMS, statusLabel, onCoverError } from '../utils.jsx';
import { loadSavedSources, loadAvailableSources } from './components/searchSources.js';
import { SkeletonExploreGrid } from './components/Skeletons.jsx';
import AddEntryModal from './components/AddEntryModal.jsx';
import AddEntryPanel from './components/AddEntryPanel.jsx';
import QuickAddModal from './components/QuickAddModal.jsx';
import EntryDetailModal from './components/EntryDetailModal.jsx';
import { useExtensionPresent, extensionGoodreadsExplore, extensionNuExplore, mergeResults } from '../extensionBridge.js';
import { usePreferences } from '../preferences.jsx';

// 32-bit unsigned integer; backend re-seeds Python's RNG with it.
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

// Fetch a large candidate pool so that filtering recommendations by source
// still leaves enough to fill the grid; the page itself paginates client-side.
const EXPLORE_FETCH_LIMIT = 120;
const REC_PAGE_SIZE = 30;

// Per-medium recommendation cache that survives navigation within the SPA
// session (module scope, not component state). Lets a source-availability change
// fetch only the newly-added sources instead of re-querying everything: removed
// sources are filtered out of the cached pool, added ones are appended.
//   medium -> { sources: string[], items, affinity, personalised }
const exploreCache = {};

export default function Explore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items,        setItems]        = useState([]);
  const [affinity,     setAffinity]     = useState(null);
  const [personalised, setPersonalised] = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [scanSeconds,  setScanSeconds]  = useState(0);
  const exploreRequestSeq = useRef(0);

  // Tick a seconds counter while a scan is running so the long source fan-out
  // shows progress (and reassures the user they don't have to wait on the page).
  useEffect(() => {
    if (!loading) { setScanSeconds(0); return; }
    setScanSeconds(0);
    const t = setInterval(() => setScanSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  // Local medium filter — always starts unset ("All") and is never persisted to
  // the URL or settings, so a reload always lands on the full mixed feed.
  const [medium, setMedium] = useState('');

  // Per-card UI state — keyed by stable index because explore items have no DB id
  // until added. Tracks: 'idle' | 'adding' | 'added:<status>' | 'error:<msg>'
  const [cardState, setCardState] = useState({});
  const [pendingAdd, setPendingAdd] = useState(null);
  // Entries created during this Explore session, keyed by card idx. Lets the
  // user click an "added" card to inspect/edit/delete it via EntryDetailModal.
  const [addedEntries, setAddedEntries] = useState({});
  const [detailEntry,  setDetailEntry]  = useState(null);
  // Bumped on every Refresh — also flips refreshFlag so the next fetch
  // bypasses the server-side per-medium cache.
  const [seed, setSeed] = useState(() => newSeed());
  const [refreshFlag, setRefreshFlag] = useState(false);
  // Mobile drawer state — '', 'left', or 'right'.
  const [drawer, setDrawer] = useState('');
  // Quick-add (backfill) modal toggle. We don't re-query mid-session on each add
  // (the background reshuffle looked jarring) — instead reconcile once on close
  // if anything was added, so recs drop the now-owned titles.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const quickAddDirty = useRef(false);
  // Selected search sources — drive BOTH the top search box and the
  // recommendation filtering below. Empty set = all sources. Restored from the
  // URL (?src=) on load so a reload keeps the search; falls back to saved prefs.
  const initialUrlSources = useRef(searchParams.get('src'));
  const initialUrlQuery = useRef(searchParams.get('q') || '');
  const [selectedSources, setSelectedSources] = useState(() => {
    const raw = initialUrlSources.current;
    if (raw != null) return new Set(raw.split(',').filter(Boolean));
    return loadSavedSources();
  });
  // True while the top search/add section is showing results or a URL preview;
  // when true we hide the recommendations and show the search output instead.
  const [searchActive, setSearchActive] = useState(false);
  // Client-side pagination over the (source-filtered) recommendations.
  const [recPage, setRecPage] = useState(1);

  // Sitewide-available sources (Console setting) — limits both the picker and
  // which recommendations are shown. Read once on mount.
  const availableSet = useMemo(() => loadAvailableSources(), []);
  const extPresent = useExtensionPresent();

  // The Explore bias settings (changed on Console) affect the ranking the backend
  // returns, so a change must bust the per-medium cache and re-fetch — otherwise
  // toggling Personalize wouldn't show until a reload.
  const { prefs } = usePreferences();
  const personalize = prefs?.explore?.personalize !== false;
  const exploreBy = prefs?.explore?.by || 'all';

  // Keep the selected sources in the URL (?src=) so a reload restores them.
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (selectedSources.size) next.set('src', [...selectedSources].join(','));
      else next.delete('src');
      return next;
    }, { replace: true });
  }, [selectedSources, setSearchParams]);

  // The active search term is recorded in the URL (?q=) by the panel on search.
  const handlePanelSearch = useCallback((q) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (q) next.set('q', q); else next.delete('q');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ── Fetch explore data whenever filters or seed change ──────────────────
  // `force` (Refresh/Reroll) always re-queries the full set; otherwise, when a
  // cached pool exists for this medium, only the newly-available sources are
  // fetched and no-longer-available ones are filtered out — so toggling a source
  // in Console doesn't trigger a slow full reroll.
  const fetchExplore = useCallback(async ({ force = false } = {}) => {
    const requestSeq = ++exploreRequestSeq.current;
    setLoading(true); setError(''); setCardState({});
    try {
      const want = [...availableSet];
      const cached = exploreCache[medium];
      // Reuse the cache only when the bias settings still match; a Personalize /
      // dimension change invalidates it and forces a fresh ranked fetch.
      const incremental = !force && !refreshFlag && cached
        && cached.personalize === personalize && cached.by === exploreBy;

      let recs, affinity, personalised;
      if (incremental) {
        const wantSet = new Set(want);
        const have = new Set(cached.sources);
        const added = want.filter(s => !have.has(s));
        recs = cached.items.filter(it => wantSet.has(it.source));
        affinity = cached.affinity;
        personalised = cached.personalised;
        if (added.length) {
          const data = await getExplore({ medium, limit: EXPLORE_FETCH_LIMIT, seed, sources: added });
          if (requestSeq !== exploreRequestSeq.current) return;
          recs = mergeResults(recs, data.items || []);
        }
      } else {
        const data = await getExplore({
          medium, limit: EXPLORE_FETCH_LIMIT, seed, refresh: refreshFlag, sources: want,
        });
        if (requestSeq !== exploreRequestSeq.current) return;
        recs = data.items || [];
        affinity = data.affinity || null;
        personalised = !!data.personalised;
      }

      exploreCache[medium] = { sources: want, items: recs, affinity, personalised, personalize, by: exploreBy };
      setItems(recs);
      setAffinity(affinity);
      setPersonalised(personalised);

      // Goodreads shelves are usually reachable server-side, but if they're
      // WAF-blocked no Goodreads books come back. When Book recs are relevant,
      // Goodreads is an available source, and the extension is present, load the
      // shelf first-party and merge the results in.
      const bookRelevant = !medium || medium === 'Book';
      if (extPresent && bookRelevant && availableSet.has('goodreads')
          && !recs.some(it => it.source === 'goodreads')) {
        const genre = (affinity?.top_genres || [])[0] || '';
        const extra = await extensionGoodreadsExplore(genre);
        if (requestSeq === exploreRequestSeq.current && extra.length) {
          setItems(prev => {
            const merged = mergeResults(prev, extra);
            if (exploreCache[medium]) exploreCache[medium].items = merged;
            return merged;
          });
        }
      }

      // NovelUpdates rankings are Cloudflare-blocked server-side, so if no
      // web-novel recs came back, NU is available, and the extension is present,
      // load a ranking page first-party (synopsis + cached covers) and merge in.
      const webNovelRelevant = !medium || medium === 'Web Novel';
      if (extPresent && webNovelRelevant && availableSet.has('novelupdates')
          && !recs.some(it => it.source === 'novelupdates')) {
        const extra = await extensionNuExplore();
        if (requestSeq === exploreRequestSeq.current && extra.length) {
          setItems(prev => {
            const merged = mergeResults(prev, extra);
            if (exploreCache[medium]) exploreCache[medium].items = merged;
            return merged;
          });
        }
      }
    } catch (e) {
      if (requestSeq !== exploreRequestSeq.current) return;
      setError(e.message);
    } finally {
      if (requestSeq !== exploreRequestSeq.current) return;
      setLoading(false);
      setRefreshFlag(false);
    }
  }, [medium, seed, refreshFlag, availableSet, extPresent, personalize, exploreBy]);

  useEffect(() => {
    fetchExplore();
  }, [fetchExplore]);

  // Reroll = bypass the server-side per-medium cache AND pick a new shuffle
  // seed, so the page surfaces a different set of suggestions.
  const handleReroll = () => {
    setRefreshFlag(true);
    setSeed(newSeed());
  };

  // Refresh = force a full re-query so "in library" tags pick up changes made
  // elsewhere (bypasses the incremental per-source path).
  const handleRefresh = () => {
    fetchExplore({ force: true });
  };

  // An entry was created from the top search/add section — re-query the current
  // recommendations so their "in library" tags pick up the new entry.
  const handleAddPanelCreated = () => {
    fetchExplore({ force: true });
  };

  // Recommendations are limited to the sitewide-available sources, then further
  // narrowed by the per-session source selection (empty = all available). Keep
  // each item's original index so per-card add/added state stays correct.
  const visibleItems = useMemo(() => {
    const withIdx = items
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => availableSet.has(item.source));
    if (selectedSources.size === 0) return withIdx;
    return withIdx.filter(({ item }) => selectedSources.has(item.source));
  }, [items, selectedSources, availableSet]);

  // Reset to the first page whenever the filtered set changes underneath us.
  useEffect(() => { setRecPage(1); }, [medium, selectedSources, items]);

  const recTotalPages = Math.max(1, Math.ceil(visibleItems.length / REC_PAGE_SIZE));
  const pagedItems = useMemo(
    () => visibleItems.slice((recPage - 1) * REC_PAGE_SIZE, recPage * REC_PAGE_SIZE),
    [visibleItems, recPage],
  );

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
    if (owned) {
      const added = addedEntries[idx];
      if (added) setDetailEntry(added);
      return;
    }
    openAddModal(idx, item, 'planned');
  }

  function handleCardKeyDown(e, idx, item, owned) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (owned) {
      const added = addedEntries[idx];
      if (added) {
        e.preventDefault();
        setDetailEntry(added);
      }
      return;
    }
    e.preventDefault();
    openAddModal(idx, item, 'planned');
  }

  function handleEntryCreated(created) {
    if (!pendingAdd) return;
    const idx = pendingAdd.idx;
    setCardState(s => ({ ...s, [idx]: `added:${created?.status || pendingAdd.status}` }));
    if (created) setAddedEntries(prev => ({ ...prev, [idx]: created }));
    // Keep the persisted pool in sync so the card stays "in library" if the user
    // navigates away and back (the incremental path reuses these cached items).
    const cached = exploreCache[medium];
    if (cached && cached.items[idx]) cached.items[idx].in_library = true;
    setPendingAdd(null);
  }

  // Detail modal callbacks: keep addedEntries in sync if the user edits or
  // deletes the entry from inside the modal. Deletion makes the card behave
  // like a normal explorable card again — but we keep the "in library"
  // overlay because the title would still match if the user re-fetches.
  function handleDetailUpdated(updated) {
    setDetailEntry(updated);
    setAddedEntries(prev => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (next[k]?.id === updated.id) next[k] = updated;
      }
      return next;
    });
  }
  function handleDetailDeleted(id) {
    // Find which card(s) the deleted entry was attached to, then clear both
    // the added-entry record and the matching `added:<status>` cardState so
    // the card returns to a clickable state.
    const idxsToClear = Object.keys(addedEntries).filter(k => addedEntries[k]?.id === id);
    setAddedEntries(prev => {
      const next = { ...prev };
      for (const k of idxsToClear) delete next[k];
      return next;
    });
    setCardState(prev => {
      const next = { ...prev };
      for (const k of idxsToClear) delete next[k];
      return next;
    });
    setDetailEntry(null);
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
            {!searchActive && (
              <span className="page-desc">
                {loading ? <span className="loading-dots">scanning{scanSeconds >= 2 ? ` ${scanSeconds}s` : ''}</span>
                         : `${visibleItems.length} suggestions`}
              </span>
            )}
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
              title="Re-query the current suggestions (refreshes 'in library' tags)"
              style={{ padding: '5px 10px' }}>
              Refresh
            </button>
            <button className="icon-btn" onClick={handleReroll} disabled={loading}
              title="Bypass cache and pull a fresh set of suggestions"
              style={{ padding: '5px 10px' }}>
              Reroll
            </button>
          </div>
        </div>

        {/* Always-on search / add section. */}
        <AddEntryPanel
          onCreated={handleAddPanelCreated}
          medium={medium}
          selectedSources={selectedSources}
          setSelectedSources={setSelectedSources}
          onActiveChange={setSearchActive}
          initialQuery={initialUrlQuery.current}
          onSearch={handlePanelSearch}
        />

        {/* Recommendations — hidden while a search/URL query is active. */}
        {!searchActive && (
        <div className="explore-recs">
          <div className="section-header explore-recs-title">Recommended for you</div>

        {error && (
          <div className="state-block">
            <div className="state-title">Error</div>
            <div className="state-detail">{error}</div>
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={handleRefresh}>Retry</button>
          </div>
        )}

        {!error && loading && (
          <div className="skeleton-page" aria-label="Loading explore">
            <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.6, marginBottom: 12 }}>
              Querying external sources{scanSeconds >= 2 ? ` · ${scanSeconds}s elapsed` : ''} — this can take a while.
              You don’t need to stay here; your suggestions will be ready when you come back.
            </div>
            <SkeletonExploreGrid cards={9} />
          </div>
        )}

        {!error && !loading && visibleItems.length === 0 && (
          <div className="state-block">
            <div className="state-title">No suggestions to surface.</div>
            <div className="state-detail">
              {items.length > 0 && selectedSources.size > 0
                ? 'No recommendations from the selected sources for this medium — clear some source filters or change the medium.'
                : 'Try a different medium, or rate a few entries to teach the recommender.'}
            </div>
          </div>
        )}

        {!error && !loading && visibleItems.length > 0 && (
        <div className="explore-grid">
          {pagedItems.map(({ item, idx }) => {
            const state = cardState[idx] || 'idle';
            const isAdded = state.startsWith('added:');
            const isError = state.startsWith('error:');
            const errMsg  = isError ? state.slice('error:'.length) : '';
            const addedAs = isAdded ? state.slice('added:'.length) : '';
            const owned       = item.in_library || isAdded;
            // An owned card is interactive only if we know the underlying
            // entry (i.e. the user added it during this Explore session and
            // we can open its detail modal). Pre-existing in_library cards
            // stay decorative.
            const interactive = !owned || !!addedEntries[idx];
            const hasMatches  = personalised && item.matches && item.matches.length > 0;

            return (
              <article key={`${item.source}:${item.external_id || item.title}:${idx}`}
                       className={'explore-card' + (owned ? ' is-owned' : '') + (interactive ? '' : ' not-interactive')}
                       role={interactive ? 'button' : undefined}
                       tabIndex={interactive ? 0 : undefined}
                       onClick={() => handleCardClick(idx, item, owned)}
                       onKeyDown={e => handleCardKeyDown(e, idx, item, owned)}>
                <div className="explore-cover">
                  {item.cover_url
                    ? <img src={item.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onCoverError} />
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

        {!error && !loading && recTotalPages > 1 && (
          <div className="explore-pagination">
            {recPage > 1 && <button className="icon-btn" onClick={() => setRecPage(1)}>« First</button>}
            <button className="icon-btn" disabled={recPage === 1} onClick={() => setRecPage(p => p - 1)}>← Prev</button>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>Page {recPage} of {recTotalPages}</span>
            <button className="icon-btn" disabled={recPage === recTotalPages} onClick={() => setRecPage(p => p + 1)}>Next →</button>
            {recPage < recTotalPages && <button className="icon-btn" onClick={() => setRecPage(recTotalPages)}>Last »</button>}
          </div>
        )}
        </div>
        )}
      </main>

      {/* ── Right sidebar: affinity snapshot ───────────────────────────────── */}
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
              {personalised
                ? 'Ranking nudges results toward your most-consumed genres, origins, and mediums. Change the bias dimension in Console → Explore.'
                : 'Personalization is off — recommendations are neutral. Turn it on in Console → Explore to bias results toward your library.'}
            </div>
          </>
        )}
        <button type="button" className="quickadd-open-btn" onClick={() => setQuickAddOpen(true)}
          style={{ marginTop: 16 }}>
          Quick Add
        </button>
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

      {quickAddOpen && (
        <QuickAddModal
          medium={medium}
          onClose={() => {
            setQuickAddOpen(false);
            if (quickAddDirty.current) {
              quickAddDirty.current = false;
              fetchExplore();
            }
          }}
          onCreated={() => { quickAddDirty.current = true; }}
        />
      )}

      {detailEntry && (
        <EntryDetailModal
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onUpdated={handleDetailUpdated}
          onDeleted={handleDetailDeleted}
        />
      )}
    </div>
  );
}
