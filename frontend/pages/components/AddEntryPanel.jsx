import { useEffect, useMemo, useRef, useState } from 'react';
import { searchMedia, fetchByUrl, checkDuplicates } from '../../api.jsx';
import { isUrl, inferSourceFromUrl, URL_SCRAPE_SOURCES, STATUSES, statusLabel, onCoverError } from '../../utils.jsx';
import { SEARCH_SOURCES, SOURCE_LABEL, resultToEntry, loadAvailableSources } from './searchSources.js';
import AddEntryModal from './AddEntryModal.jsx';
import ExtensionInstallHint from './ExtensionInstallHint.jsx';
import CustomSelect from './CustomSelect.jsx';
import { useExtensionPresent, extensionNuSearch, mergeResults } from '../../extensionBridge.js';

/**
 * Always-on search / add section that sits at the top of the unified Explore
 * page. Paste a URL for a rich preview, or search by title to pick from a card
 * grid (clicking a card opens the prefilled add form). `selectedSources` is
 * controlled by Explore (it also filters the recommendations below). While this
 * section has produced output it reports `active=true` via `onActiveChange`, so
 * Explore can hide the recommendations until the query is cleared.
 */
export default function AddEntryPanel({
  onCreated,
  medium = '',
  selectedSources,
  setSelectedSources,
  onActiveChange,
  initialQuery = '',
  onSearch,
}) {
  const [query,     setQuery]     = useState(initialQuery || '');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');

  // URL path
  const [previews, setPreviews] = useState(null);   // SearchResult[] | null
  // Keyword path
  const [results,  setResults]  = useState(null);   // SearchResult[] | null
  const [inLibrary, setInLibrary] = useState([]);
  const [addedResults, setAddedResults] = useState({});

  const [previewStatus, setPreviewStatus] = useState({});
  // Entry currently being added via the shared add form (manual tab).
  const [pendingAdd, setPendingAdd] = useState(null);
  const [nuSearching, setNuSearching] = useState(false);
  const extPresent = useExtensionPresent();

  // Sitewide-available sources gate which chips show and what an unfiltered
  // search fans out across (read once on mount; changed in Console).
  const availableSet = useMemo(() => loadAvailableSources(), []);
  const availableList = useMemo(() => SEARCH_SOURCES.filter(s => availableSet.has(s.value)), [availableSet]);

  const nuRequested = (selectedSources.size === 0 || selectedSources.has('novelupdates')) && availableSet.has('novelupdates');

  async function runDupCheck(list) {
    if (!list.length) { setInLibrary([]); return; }
    try {
      const check = await checkDuplicates(
        list.map(r => ({ title: r.title, year: r.year ?? null, medium: r.medium ?? null }))
      );
      setInLibrary(check.exists);
    } catch (_) { /* non-critical */ }
  }

  const urlMode = isUrl(query);
  const detectedSource = urlMode ? inferSourceFromUrl(query.trim()) : '';

  // Apply the left-sidebar medium filter to whatever results are showing.
  const matchesMedium = (item) => !medium || item.medium === medium;
  const shownResults = useMemo(
    () => (results || []).map((r, i) => ({ r, i })).filter(({ r }) => matchesMedium(r)),
    [results, medium],
  );
  const shownPreviews = useMemo(
    () => (previews || []).filter(matchesMedium),
    [previews, medium],
  );

  // "Active" = this section is showing output that should replace the recs.
  const active = previews !== null || results !== null || searching || !!searchErr;
  const canClear = active || Boolean(query.trim()) || selectedSources.size > 0;
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  function toggleSource(value) {
    setSelectedSources(prev => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  function resetResults() {
    setPreviews(null); setResults(null); setInLibrary([]); setAddedResults({}); setPreviewStatus({}); setSearchErr('');
  }

  function clearSourcesAndSearch() {
    setSelectedSources(new Set());
    setQuery('');
    resetResults();
    onSearch?.('');
  }

  function onQueryChange(value) {
    setQuery(value);
    // Clearing the box returns the page to recommendations.
    if (!value.trim()) { resetResults(); onSearch?.(''); }
  }

  function handleSearch(e) {
    e.preventDefault();
    performSearch(query);
  }

  async function performSearch(rawQuery) {
    const q = (rawQuery || '').trim();
    if (!q) return;
    onSearch?.(q);  // record the executed search in the URL
    setSearching(true); setSearchErr(''); setPreviews(null); setResults(null); setInLibrary([]); setAddedResults({}); setPreviewStatus({});
    try {
      if (isUrl(q)) {
        const src = inferSourceFromUrl(q);
        if (!URL_SCRAPE_SOURCES.has(src)) {
          setSearchErr("URL import isn't supported for this site yet — try a title search or manual entry.");
          return;
        }
        const data = await fetchByUrl(q);
        const found = Array.isArray(data) ? data : [];
        if (found.length === 0) {
          setSearchErr("Couldn't read that page — it may be unavailable or its layout changed. Try a title search.");
          return;
        }
        setPreviews(found);
        return;
      }
      const sources = (selectedSources.size ? [...selectedSources] : availableList.map(s => s.value))
        .filter(v => availableSet.has(v));
      const data = await searchMedia(q, sources, true);
      let list = Array.isArray(data) ? data : data?.results ?? [];
      setResults(list);
      await runDupCheck(list);

      // Silent NovelUpdates fallback via the extension (NU search is
      // Cloudflare-blocked server-side); merge its results in when present.
      if (nuRequested && extPresent) {
        setNuSearching(true);
        try {
          const nu = await extensionNuSearch(q);
          if (nu.length) {
            list = mergeResults(list, nu);
            setResults(list);
            await runDupCheck(list);
          }
        } finally {
          setNuSearching(false);
        }
      }
    } catch (err) {
      setSearchErr(err.message);
    } finally {
      setSearching(false);
    }
  }

  // On first mount, re-run a search restored from the URL (?q=) so a reload
  // brings the results back instead of resetting to recommendations.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (initialQuery && initialQuery.trim()) performSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the shared add form (manual tab) prefilled from a result/preview.
  function openAdd(item, statusValue, resultIndex = null) {
    const entry = resultToEntry(item);
    setPendingAdd({
      entry: statusValue ? { ...entry, status: statusValue } : entry,
      resultIndex,
      status: statusValue || entry.status || 'planned',
    });
  }

  function handleCreated(created) {
    if (pendingAdd?.resultIndex != null) {
      setAddedResults(prev => ({
        ...prev,
        [pendingAdd.resultIndex]: created || { status: pendingAdd.status },
      }));
      setInLibrary(prev => {
        const next = [...prev];
        next[pendingAdd.resultIndex] = true;
        return next;
      });
    }
    onCreated?.(created);
    setPendingAdd(null);
  }

  return (
    <div className="add-panel">
      <form onSubmit={handleSearch} className="add-panel-search">
        <div className="add-panel-search-row">
          <input
            className="form-input add-panel-query"
            placeholder="Search a title, or paste a URL to add…"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
          />
          <button className="btn" type="submit" disabled={searching || !query.trim()}>
            {searching ? '…' : urlMode ? 'Import' : 'Search'}
          </button>
          <button
            className="btn btn-outline add-panel-clear-btn"
            type="button"
            disabled={!canClear}
            onClick={clearSourcesAndSearch}
          >
            Clear
          </button>
        </div>

        {urlMode ? (
          <div className="add-url-mode-note">
            {URL_SCRAPE_SOURCES.has(detectedSource)
              ? `Detected ${SOURCE_LABEL[detectedSource] ?? detectedSource} link — source toggles ignored`
              : 'Paste a supported media URL (TMDB, AniList, MAL, NovelUpdates, Goodreads book/series, IMDb, …)'}
          </div>
        ) : (
          <div className="source-select source-select-wide add-source-select">
            <div className="source-select-head">
              <span className="form-label">Sources — filter recommendations &amp; search</span>
            </div>
            <div className="source-grid">
              {availableList.map(s => {
                const on = selectedSources.has(s.value);
                return (
                  <button
                    key={s.value}
                    type="button"
                    className={`source-chip${on ? ' is-on' : ''}`}
                    onClick={() => toggleSource(s.value)}
                  >
                    <span className="source-box">{on ? '[x]' : '[ ]'}</span>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </form>

      {searchErr && (
        <div className="state-block add-search-error">
          <div className="state-detail text-red">{searchErr}</div>
        </div>
      )}

      {/* ── URL rich preview ── */}
      {previews && (
        shownPreviews.length === 0
          ? <div className="state-block"><div className="state-detail">No preview matches the “{medium}” filter.</div></div>
          : <div className="add-preview-list">
              {shownPreviews.map((item, idx) => (
                <article key={`${item.source}:${item.external_id || item.title}:${idx}`} className="add-preview">
                  <div className="add-preview-cover">
                    {item.cover_url
                      ? <img src={item.cover_url} alt="" referrerPolicy="no-referrer" onError={onCoverError} />
                      : <div className="explore-cover-empty">—</div>}
                  </div>
                  <div className="add-preview-body">
                    <div className="add-preview-title-row">
                      {item.external_url
                        ? <a href={item.external_url} target="_blank" rel="noopener noreferrer" className="add-preview-title">{item.title}</a>
                        : <span className="add-preview-title">{item.title}</span>}
                      {item.source && <span className="add-preview-source">{SOURCE_LABEL[item.source] ?? item.source}</span>}
                    </div>
                    <div className="add-preview-meta">
                      {[item.medium, item.year, item.origin].filter(Boolean).join(' · ')}
                      {item.external_rating != null && (
                        <span className="explore-meta-rating"> · ★ {item.external_rating.toFixed(1)}</span>
                      )}
                    </div>
                    {item.genres && <div className="add-preview-genres">{item.genres}</div>}
                    {item.description && <p className="add-preview-desc">{item.description}</p>}
                    <div className="add-preview-actions">
                      <CustomSelect
                        value={previewStatus[idx] || 'current'}
                        options={STATUSES.map(status => ({
                          value: status,
                          label: statusLabel(status),
                        }))}
                        onChange={value => setPreviewStatus(s => ({ ...s, [idx]: value }))}
                        containerClassName="add-preview-status"
                        ariaLabel={`Status for ${item.title}`}
                      />
                      <button className="btn" type="button" onClick={() => openAdd(item, previewStatus[idx] || 'current')}>
                        Add to Library
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
      )}

      {/* ── Keyword results grid ── */}
      {results !== null && (
        shownResults.length === 0
          ? <div className="state-block"><div className="state-detail">
              {nuSearching
                ? <span className="loading-dots">Searching NovelUpdates</span>
                : results.length === 0
                  ? 'No results — try a different title or source.'
                  : `No results match the “${medium}” filter.`}
              {!nuSearching && nuRequested && !extPresent && (
                <div className="add-extension-hint"><ExtensionInstallHint context="search" /></div>
              )}
            </div></div>
          : <div className="explore-grid add-results-grid">
              {shownResults.map(({ r, i }) => {
                const added = addedResults[i];
                const addedStatus = added?.status || '';
                const owned = inLibrary[i] || Boolean(added);
                return (
                  <article
                    key={`${r.source}:${r.external_id || r.title}:${i}`}
                    className={'explore-card' + (owned ? ' is-owned not-interactive' : '')}
                    role={owned ? undefined : 'button'}
                    tabIndex={owned ? undefined : 0}
                    onClick={() => { if (!owned) openAdd(r, 'planned', i); }}
                    onKeyDown={e => {
                      if (owned) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAdd(r, 'planned', i); }
                    }}
                  >
                    <div className="explore-cover">
                      {(r.cover_url || r.cover)
                        ? <img src={r.cover_url || r.cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={onCoverError} />
                        : <div className="explore-cover-empty">—</div>}
                    </div>
                    <div className="explore-body">
                      <div className="explore-title-row">
                        {r.external_url
                          ? <a href={r.external_url} target="_blank" rel="noopener noreferrer"
                               onClick={e => e.stopPropagation()} className="explore-title">{r.title}</a>
                          : <span className="explore-title">{r.title}</span>}
                      </div>
                      <div className="explore-meta">
                        {r.medium && <span>{r.medium}</span>}
                        {r.year   && <span> · {r.year}</span>}
                        {r.origin && <span> · {r.origin}</span>}
                        {r.external_rating != null && (
                          <span> · <span className="explore-meta-rating">★ {r.external_rating.toFixed(1)}</span></span>
                        )}
                      </div>
                      {r.description && <p className="explore-desc no-match">{r.description}</p>}
                    </div>
                    {owned && (
                      <div className={'explore-card-overlay explore-card-added-overlay' + (addedStatus ? ` status-${addedStatus}` : '')}>
                        <span>{addedStatus ? `✓ added · ${statusLabel(addedStatus)}` : '✓ in library'}</span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
      )}

      {nuSearching && shownResults.length > 0 && (
        <div className="add-nu-searching">
          <span className="loading-dots">Searching NovelUpdates</span>
        </div>
      )}

      {pendingAdd && (
        <AddEntryModal
          initialTab="manual"
          initialEntry={pendingAdd.entry}
          hideTabs
          onClose={() => setPendingAdd(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
