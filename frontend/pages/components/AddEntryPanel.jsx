import { useEffect, useMemo, useState } from 'react';
import { searchMedia, fetchByUrl, checkDuplicates } from '../../api.jsx';
import { isUrl, inferSourceFromUrl, URL_SCRAPE_SOURCES, STATUSES, statusLabel } from '../../utils.jsx';
import { SEARCH_SOURCES, SOURCE_LABEL, saveSources, resultToEntry } from './searchSources.js';
import AddEntryModal from './AddEntryModal.jsx';

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
}) {
  const [query,     setQuery]     = useState('');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');

  // URL path
  const [previews, setPreviews] = useState(null);   // SearchResult[] | null
  // Keyword path
  const [results,  setResults]  = useState(null);   // SearchResult[] | null
  const [inLibrary, setInLibrary] = useState([]);

  const [previewStatus, setPreviewStatus] = useState({});
  // Entry currently being added via the shared add form (manual tab).
  const [pendingAdd, setPendingAdd] = useState(null);

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
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);

  function toggleSource(value) {
    setSelectedSources(prev => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      saveSources(next);
      return next;
    });
  }

  function resetResults() {
    setPreviews(null); setResults(null); setInLibrary([]); setPreviewStatus({}); setSearchErr('');
  }

  function clearSourcesAndSearch() {
    setSelectedSources(new Set());
    saveSources(new Set());
    setQuery('');
    resetResults();
  }

  function onQueryChange(value) {
    setQuery(value);
    // Clearing the box returns the page to recommendations.
    if (!value.trim()) resetResults();
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setSearchErr(''); setPreviews(null); setResults(null); setInLibrary([]); setPreviewStatus({});
    try {
      if (isUrl(query)) {
        const src = inferSourceFromUrl(query.trim());
        if (!URL_SCRAPE_SOURCES.has(src)) {
          setSearchErr("URL import isn't supported for this site yet — try a title search or manual entry.");
          return;
        }
        const data = await fetchByUrl(query.trim());
        const found = Array.isArray(data) ? data : [];
        if (found.length === 0) {
          setSearchErr("Couldn't read that page — it may be unavailable or its layout changed. Try a title search.");
          return;
        }
        setPreviews(found);
        return;
      }
      const sources = selectedSources.size
        ? [...selectedSources]
        : SEARCH_SOURCES.map(s => s.value);
      const data = await searchMedia(query.trim(), sources, true);
      const list = Array.isArray(data) ? data : data?.results ?? [];
      setResults(list);
      if (list.length > 0) {
        try {
          const check = await checkDuplicates(
            list.map(r => ({ title: r.title, year: r.year ?? null, medium: r.medium ?? null }))
          );
          setInLibrary(check.exists);
        } catch (_) { /* non-critical */ }
      }
    } catch (err) {
      setSearchErr(err.message);
    } finally {
      setSearching(false);
    }
  }

  // Open the shared add form (manual tab) prefilled from a result/preview.
  function openAdd(item, statusValue) {
    const entry = resultToEntry(item);
    setPendingAdd(statusValue ? { ...entry, status: statusValue } : entry);
  }

  function handleCreated(created) {
    onCreated?.(created);
    setPendingAdd(null);
  }

  return (
    <div className="add-panel">
      <form onSubmit={handleSearch} className="add-panel-search">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            style={{ flex: 1 }}
            placeholder="Search a title, or paste a URL to add…"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
          />
          <button className="btn" type="submit" disabled={searching || !query.trim()}>
            {searching ? '…' : urlMode ? 'Import' : 'Search'}
          </button>
        </div>

        {urlMode ? (
          <div style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: '0.03em', padding: '6px 0 0' }}>
            {URL_SCRAPE_SOURCES.has(detectedSource)
              ? `Detected ${SOURCE_LABEL[detectedSource] ?? detectedSource} link — source toggles ignored`
              : 'Paste a supported media URL (TMDB, AniList, MAL, NovelUpdates, IMDb, …)'}
          </div>
        ) : (
          <div className="source-select source-select-wide" style={{ marginTop: 10 }}>
            <div className="source-select-head">
              <span className="form-label">Sources — filter recommendations &amp; search</span>
            </div>
            <div className="source-grid">
              {SEARCH_SOURCES.map(s => {
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
              <button
                type="button"
                className="source-chip source-clear-chip"
                onClick={clearSourcesAndSearch}
              >
                Clear{selectedSources.size ? ` (${selectedSources.size})` : ''}
              </button>
            </div>
          </div>
        )}
      </form>

      {searchErr && (
        <div className="state-block" style={{ marginTop: 4 }}>
          <div className="state-detail" style={{ color: 'var(--red)' }}>{searchErr}</div>
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
                      ? <img src={item.cover_url} alt="" onError={ev => { ev.target.style.display = 'none'; }} />
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
                      <select
                        className="form-input"
                        style={{ width: 'auto' }}
                        value={previewStatus[idx] || 'current'}
                        onChange={e => setPreviewStatus(s => ({ ...s, [idx]: e.target.value }))}
                      >
                        {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                      </select>
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
              {results.length === 0
                ? 'No results — try a different title or source.'
                : `No results match the “${medium}” filter.`}
            </div></div>
          : <div className="explore-grid" style={{ marginTop: 12 }}>
              {shownResults.map(({ r, i }) => {
                const owned = inLibrary[i];
                return (
                  <article
                    key={`${r.source}:${r.external_id || r.title}:${i}`}
                    className={'explore-card' + (owned ? ' is-owned not-interactive' : '')}
                    role={owned ? undefined : 'button'}
                    tabIndex={owned ? undefined : 0}
                    onClick={() => { if (!owned) openAdd(r, 'planned'); }}
                    onKeyDown={e => {
                      if (owned) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAdd(r, 'planned'); }
                    }}
                  >
                    <div className="explore-cover">
                      {(r.cover_url || r.cover)
                        ? <img src={r.cover_url || r.cover} alt="" loading="lazy" />
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
                      <div className="explore-card-overlay explore-card-added-overlay">
                        <span>✓ in library</span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
      )}

      {pendingAdd && (
        <AddEntryModal
          initialTab="manual"
          initialEntry={pendingAdd}
          hideTabs
          onClose={() => setPendingAdd(null)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
