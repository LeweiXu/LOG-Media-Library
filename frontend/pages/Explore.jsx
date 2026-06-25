import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getExplore } from '../api.jsx';
import { MEDIUMS, statusLabel, onCoverError } from '../utils.jsx';
import { loadAvailableSources } from './components/searchSources.js';
import { SkeletonExploreGrid } from './components/Skeletons.jsx';
import AddEntryModal from './components/AddEntryModal.jsx';
import AddEntryPanel from './components/AddEntryPanel.jsx';
import QuickAddModal from './components/QuickAddModal.jsx';
import EntryDetailModal from './components/EntryDetailModal.jsx';
import { useExtensionPresent, extensionGoodreadsExplore, extensionNuExplore, mergeResults } from '../extensionBridge.js';
import { usePreferences } from '../preferences.jsx';

// 32-bit unsigned integer; backend re-seeds Python's RNG with it.
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

// Stable identity for an explore item (mirrors the backend's de-dupe key) —
// used for the React list key and to key per-card UI state (add/added/error)
// instead of array index. Index isn't safe once a per-medium reroll can splice
// just one medium's slice out of `items` and append a fresh batch: indices of
// every *other*, untouched card would shift and silently pick up the wrong
// card state.
const itemKey = (item) => `${(item.title || '').toLowerCase().trim()}|${item.medium || ''}`;

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

// In-flight FULL explore fetches (Reroll/Refresh, or any cache miss), keyed by
// effectiveMedium — module scope, not component state. This is the slow
// multi-provider scan the loading message tells users they can leave the page
// during, so the request must never be tied to (or cancelled by) any one
// component instance: navigating away and back just remounts the page, which
// then finds the same promise here and joins it (showing the loading skeleton
// the whole time) instead of starting a duplicate scan or rendering stale
// cached data as if the reroll had been silently dropped.
const exploreFullFetchInFlight = {};
// When each in-flight full fetch actually started (module scope, alongside the
// promise above) — lets a remounted page compute the real elapsed time instead
// of restarting the "Ns elapsed" counter from 0 just because it's a new mount.
const exploreFullFetchStartedAt = {};

function fetchExploreFull(effectiveMedium, { seed, refreshFlag, want }) {
  const existing = exploreFullFetchInFlight[effectiveMedium];
  if (existing) return existing;
  exploreFullFetchStartedAt[effectiveMedium] = Date.now();
  const promise = getExplore({
    medium: effectiveMedium, limit: EXPLORE_FETCH_LIMIT, seed, refresh: refreshFlag, sources: want,
  }).finally(() => {
    if (exploreFullFetchInFlight[effectiveMedium] === promise) {
      delete exploreFullFetchInFlight[effectiveMedium];
      delete exploreFullFetchStartedAt[effectiveMedium];
    }
  });
  exploreFullFetchInFlight[effectiveMedium] = promise;
  return promise;
}

export default function Explore() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items,        setItems]        = useState([]);
  const [affinity,     setAffinity]     = useState(null);
  const [personalised, setPersonalised] = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [scanSeconds,  setScanSeconds]  = useState(0);
  const exploreRequestSeq = useRef(0);

  // Medium filter — restored from the URL (?medium=) on load and kept in sync
  // there, so a reload (or a shared link) lands on the same filtered view.
  const initialUrlMedium = useRef(searchParams.get('medium') || '');
  const [medium, setMedium] = useState(
    () => (MEDIUMS.includes(initialUrlMedium.current) ? initialUrlMedium.current : ''),
  );

  // Per-card UI state — keyed by `itemKey()` (title+medium) because explore
  // items have no DB id until added. Tracks: 'idle' | 'adding' | 'added:<status>' | 'error:<msg>'
  const [cardState, setCardState] = useState({});
  const [pendingAdd, setPendingAdd] = useState(null);
  // Entries created during this Explore session, keyed by `itemKey()`. Lets the
  // user click an "added" card to inspect/edit/delete it via EntryDetailModal.
  const [addedEntries, setAddedEntries] = useState({});
  // Mediums currently being individually rerolled (Reroll button while a
  // specific medium filter is selected) — lets several mediums reroll in
  // parallel, independent of the global `loading` flag used by "Reroll All".
  const [rerollingMediums, setRerollingMediums] = useState(() => new Set());
  const [mediumRerollError, setMediumRerollError] = useState('');
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
  // recommendation filtering below. Empty set = all sources. Plain in-memory
  // state (never persisted) so a page reload always starts unfiltered.
  const initialUrlQuery = useRef(searchParams.get('q') || '');
  const [selectedSources, setSelectedSources] = useState(() => new Set());
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
  // New default: "All" is one combined feed across every medium and the left
  // sidebar is a pure client-side filter over it. When off, fall back to the
  // legacy behaviour where each medium (and "All") is its own server fetch.
  const combineAll = prefs?.explore?.combine_all !== false;
  // What the server actually fetches/caches: in combine mode it's always the
  // mixed "" feed (the sidebar filters client-side), so changing `medium` never
  // triggers a refetch. In legacy mode it tracks the selected medium.
  const effectiveMedium = combineAll ? '' : medium;
  // Confirm dialog before a reroll that scans every medium (the slow path).
  const [confirmReroll, setConfirmReroll] = useState(false);

  // Tick a seconds counter while a scan is running so the long source fan-out
  // shows progress. Derived from the in-flight fetch's real start time (module
  // scope, see `exploreFullFetchStartedAt` above) rather than this component's
  // own mount time, so switching away and back mid-scan shows the actual
  // elapsed time instead of restarting the count from 0.
  useEffect(() => {
    if (!loading) { setScanSeconds(0); return; }
    const tick = () => {
      const startedAt = exploreFullFetchStartedAt[effectiveMedium];
      setScanSeconds(startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [loading, effectiveMedium]);

  // Keep the medium filter in the URL (?medium=) so a reload restores it.
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (medium) next.set('medium', medium); else next.delete('medium');
      return next;
    }, { replace: true });
  }, [medium, setSearchParams]);

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
      const cached = exploreCache[effectiveMedium];
      // A full (cache-busting) fetch already running for this medium — e.g. a
      // Reroll started before the user navigated away and came back. Treat that
      // exactly like a cache miss below (join it, stay in "loading") instead of
      // rendering the stale pre-reroll cache just because this mount's own
      // `force`/`refreshFlag` happen to be false.
      const fullInFlight = !!exploreFullFetchInFlight[effectiveMedium];
      // Reuse the cache only when the bias settings still match; a Personalize /
      // dimension change invalidates it and forces a fresh ranked fetch.
      const incremental = !force && !refreshFlag && !fullInFlight && cached
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
          const data = await getExplore({ medium: effectiveMedium, limit: EXPLORE_FETCH_LIMIT, seed, sources: added });
          if (requestSeq !== exploreRequestSeq.current) return;
          recs = mergeResults(recs, data.items || []);
        }
      } else {
        // Joins the shared in-flight promise if one is already running for this
        // medium, rather than firing a second concurrent scan — the network
        // request itself is never aborted by leaving the page, so any (re)mount
        // just attaches to whatever's already in progress.
        const data = await fetchExploreFull(effectiveMedium, { seed, refreshFlag, want });
        if (requestSeq !== exploreRequestSeq.current) return;
        recs = data.items || [];
        affinity = data.affinity || null;
        personalised = !!data.personalised;
      }

      exploreCache[effectiveMedium] = { sources: want, items: recs, affinity, personalised, personalize, by: exploreBy };
      setItems(recs);
      setAffinity(affinity);
      setPersonalised(personalised);

      // Goodreads shelves are usually reachable server-side, but if they're
      // WAF-blocked no Goodreads books come back. When Book recs are relevant,
      // Goodreads is an available source, and the extension is present, load the
      // shelf first-party and merge the results in. (The combined feed always
      // includes books, so effectiveMedium is "" there.)
      const bookRelevant = !effectiveMedium || effectiveMedium === 'Book';
      if (extPresent && bookRelevant && availableSet.has('goodreads')
          && !recs.some(it => it.source === 'goodreads')) {
        const genre = (affinity?.top_genres || [])[0] || '';
        const extra = await extensionGoodreadsExplore(genre);
        if (requestSeq === exploreRequestSeq.current && extra.length) {
          setItems(prev => {
            const merged = mergeResults(prev, extra);
            if (exploreCache[effectiveMedium]) exploreCache[effectiveMedium].items = merged;
            return merged;
          });
        }
      }

      // NovelUpdates rankings are Cloudflare-blocked server-side, so if no
      // web-novel recs came back, NU is available, and the extension is present,
      // load a ranking page first-party (synopsis + cached covers) and merge in.
      const webNovelRelevant = !effectiveMedium || effectiveMedium === 'Web Novel';
      if (extPresent && webNovelRelevant && availableSet.has('novelupdates')
          && !recs.some(it => it.source === 'novelupdates')) {
        const extra = await extensionNuExplore();
        if (requestSeq === exploreRequestSeq.current && extra.length) {
          setItems(prev => {
            const merged = mergeResults(prev, extra);
            if (exploreCache[effectiveMedium]) exploreCache[effectiveMedium].items = merged;
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
  }, [effectiveMedium, seed, refreshFlag, availableSet, extPresent, personalize, exploreBy]);

  useEffect(() => {
    fetchExplore();
  }, [fetchExplore]);

  // Reroll All = bypass the server-side cache AND pick a new shuffle seed, so
  // the page surfaces a different set of suggestions across every medium.
  const doReroll = () => {
    setRefreshFlag(true);
    setSeed(newSeed());
  };

  // Reroll a single medium within the combined pool: fetch a fresh, full-quota
  // batch for just that medium (the backend's single-medium path, independent
  // of the combined "" feed's own cache/in-flight key) and splice it in,
  // leaving every other medium's cards untouched. Several mediums can run
  // this in parallel since `fetchExploreFull` tracks in-flight work per key.
  async function doRerollMedium(targetMedium) {
    setMediumRerollError('');
    setRerollingMediums(prev => new Set(prev).add(targetMedium));
    try {
      const want = [...availableSet];
      const data = await fetchExploreFull(targetMedium, { seed: newSeed(), refreshFlag: true, want });
      const fresh = data.items || [];
      setItems(prev => {
        const merged = [...prev.filter(it => it.medium !== targetMedium), ...fresh];
        // Keep the combined-feed cache (always keyed by effectiveMedium, "" in
        // combine mode) in sync so a later remount/incremental fetch doesn't
        // resurrect the stale pre-reroll slice for this medium.
        const combinedCache = exploreCache[effectiveMedium];
        if (combinedCache) combinedCache.items = merged;
        return merged;
      });
    } catch (e) {
      setMediumRerollError(e.message || String(e));
    } finally {
      setRerollingMediums(prev => {
        const next = new Set(prev);
        next.delete(targetMedium);
        return next;
      });
    }
  }

  // In combine mode, a medium filter scopes Reroll to just that medium (fast,
  // no confirm needed) — only "All" runs the slow every-medium scan, so that's
  // the only one gated behind a "this may take a while" confirm. Outside
  // combine mode, `effectiveMedium` already tracks the sidebar filter, so the
  // existing per-medium `doReroll` path is already correctly scoped.
  const rerollScansAllMediums = !medium;
  const handleReroll = () => {
    if (medium && combineAll) doRerollMedium(medium);
    else if (rerollScansAllMediums) setConfirmReroll(true);
    else doReroll();
  };

  // The "All" reroll confirm is medium-specific, so drop it if the filter moves.
  useEffect(() => { setConfirmReroll(false); }, [medium]);

  // Busy/label state for whichever reroll this button currently represents.
  const thisRerollBusy = medium && combineAll ? rerollingMediums.has(medium) : loading;
  const rerollLabel = medium ? `Reroll ${medium}` : 'Reroll All';

  // Reroll control for the right sidebar. The "this may take a while" confirm
  // for the slow all-mediums reroll replaces the button inline (no modal).
  const rerollControl = confirmReroll ? (
    <div className="explore-reroll-confirm">
      <span className="explore-reroll-confirm-msg">This may take a while.</span>
      <div className="explore-reroll-confirm-actions">
        <button type="button" className="btn"
          onClick={() => { setConfirmReroll(false); doReroll(); }}>Confirm</button>
        <button type="button" className="btn btn-outline"
          onClick={() => setConfirmReroll(false)}>Cancel</button>
      </div>
    </div>
  ) : (
    <>
      <button type="button" className="quickadd-open-btn explore-reroll-btn"
        onClick={handleReroll} disabled={thisRerollBusy}
        title={medium ? `Pull a fresh set of ${medium} suggestions` : 'Pull a fresh set of suggestions for every medium'}>
        {thisRerollBusy ? 'Rerolling…' : rerollLabel}
      </button>
      {mediumRerollError && <div className="explore-reroll-error">{mediumRerollError}</div>}
    </>
  );

  // Quick Add control — now rendered at the bottom of the sidebar, in the
  // position Reroll used to occupy.
  const quickAddControl = (
    <button type="button" className="quickadd-open-btn" onClick={() => setQuickAddOpen(true)}>
      Quick Add
    </button>
  );

  // Force a full re-query so "in library" tags pick up changes made elsewhere
  // (bypasses the incremental per-source path). Used by error-retry and after an
  // add from the search panel.
  const handleRefresh = () => {
    fetchExplore({ force: true });
  };

  // An entry was created from the top search/add section — re-query the current
  // recommendations so their "in library" tags pick up the new entry.
  const handleAddPanelCreated = () => {
    fetchExplore({ force: true });
  };

  // Recommendations are limited to the sitewide-available sources. In combine
  // mode the left-sidebar medium narrows the one mixed feed client-side (source
  // selection no longer filters recs — it only scopes the search box). A medium
  // currently being individually rerolled is hidden entirely (from "All" too)
  // until its fresh batch lands, rather than showing the stale pre-reroll cards.
  const visibleItems = useMemo(() => {
    const withKey = items
      .map(item => ({ item, key: itemKey(item) }))
      .filter(({ item }) => availableSet.has(item.source) && !rerollingMediums.has(item.medium));
    if (combineAll && medium) return withKey.filter(({ item }) => item.medium === medium);
    return withKey;
  }, [items, availableSet, combineAll, medium, rerollingMediums]);

  // True when the grid is empty *because* a reroll is in progress for every
  // medium currently in view (e.g. filtered to exactly the medium being
  // rerolled) — show the loading skeleton instead of "no suggestions" then.
  const visibleMediumRerolling = visibleItems.length === 0 && rerollingMediums.size > 0;

  // Reset to the first page whenever the filtered set changes underneath us.
  useEffect(() => { setRecPage(1); }, [medium, items]);

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

  function openAddModal(key, item, statusValue) {
    setPendingAdd({
      key,
      status: statusValue,
      entry: entryFromExploreItem(item, statusValue),
    });
  }

  function handleCardClick(key, item, owned) {
    if (owned) {
      const added = addedEntries[key];
      if (added) setDetailEntry(added);
      return;
    }
    openAddModal(key, item, 'planned');
  }

  function handleCardKeyDown(e, key, item, owned) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (owned) {
      const added = addedEntries[key];
      if (added) {
        e.preventDefault();
        setDetailEntry(added);
      }
      return;
    }
    e.preventDefault();
    openAddModal(key, item, 'planned');
  }

  function handleEntryCreated(created) {
    if (!pendingAdd) return;
    const key = pendingAdd.key;
    setCardState(s => ({ ...s, [key]: `added:${created?.status || pendingAdd.status}` }));
    if (created) setAddedEntries(prev => ({ ...prev, [key]: created }));
    // Keep the persisted pool in sync so the card stays "in library" if the user
    // navigates away and back (the incremental path reuses these cached items).
    const cached = exploreCache[effectiveMedium];
    if (cached) {
      const target = cached.items.find(it => itemKey(it) === key);
      if (target) target.in_library = true;
    }
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
    const keysToClear = Object.keys(addedEntries).filter(k => addedEntries[k]?.id === id);
    setAddedEntries(prev => {
      const next = { ...prev };
      for (const k of keysToClear) delete next[k];
      return next;
    });
    setCardState(prev => {
      const next = { ...prev };
      for (const k of keysToClear) delete next[k];
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
                {loading || visibleMediumRerolling
                  ? <span className="loading-dots">scanning</span>
                  : `${visibleItems.length} suggestions`}
              </span>
            )}
          </div>
          <div className="page-head-mobile">
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'right' ? '' : 'right')}
              aria-label="Toggle taste profile & actions"
              title="Taste & actions"
            >⋯</button>
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

        {!error && !loading && visibleMediumRerolling && (
          <div className="skeleton-page" aria-label={`Rerolling ${medium || 'medium'}`}>
            <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.6, marginBottom: 12 }}>
              Rerolling {medium || [...rerollingMediums].join(', ')}…
            </div>
            <SkeletonExploreGrid cards={6} />
          </div>
        )}

        {!error && !loading && !visibleMediumRerolling && visibleItems.length === 0 && (
          <div className="state-block">
            <div className="state-title">No suggestions to surface.</div>
            <div className="state-detail">
              {combineAll && medium && items.length > 0
                ? 'Nothing for this medium in the current feed — pick another medium or reroll.'
                : 'Try a different medium, or rate a few entries to teach the recommender.'}
            </div>
          </div>
        )}

        {!error && !loading && visibleItems.length > 0 && (
        <div className="explore-grid">
          {pagedItems.map(({ item, key }) => {
            const state = cardState[key] || 'idle';
            const isAdded = state.startsWith('added:');
            const isError = state.startsWith('error:');
            const errMsg  = isError ? state.slice('error:'.length) : '';
            const addedAs = isAdded ? state.slice('added:'.length) : '';
            const owned       = item.in_library || isAdded;
            // An owned card is interactive only if we know the underlying
            // entry (i.e. the user added it during this Explore session and
            // we can open its detail modal). Pre-existing in_library cards
            // stay decorative.
            const interactive = !owned || !!addedEntries[key];
            const hasMatches  = personalised && item.matches && item.matches.length > 0;

            return (
              <article key={key}
                       className={'explore-card' + (owned ? ' is-owned' : '') + (interactive ? '' : ' not-interactive')}
                       role={interactive ? 'button' : undefined}
                       tabIndex={interactive ? 0 : undefined}
                       onClick={() => handleCardClick(key, item, owned)}
                       onKeyDown={e => handleCardKeyDown(e, key, item, owned)}>
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

      {/* ── Right sidebar: affinity snapshot + actions ─────────────────────── */}
      <aside className="sidebar-right">
        <div className="panel-title">Your library</div>
        {!affinity || affinity.sample_size === 0 ? (
          <>
            <p className="explore-affinity-empty">
              Add a few entries to your library to bias what shows up here.
            </p>
            {quickAddControl}
          </>
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

            {quickAddControl}

            <div className="explore-affinity-note">
              {personalised
                ? 'Ranking nudges results toward your most-consumed genres, origins, and mediums. Change the bias dimension in Console → Explore.'
                : 'Personalization is off — recommendations are neutral. Turn it on in Console → Explore to bias results toward your library.'}
            </div>
          </>
        )}
        <div style={{ marginTop: 16 }}>{rerollControl}</div>
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
