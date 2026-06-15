import { useState } from 'react';
import { searchMedia, fetchByUrl, checkDuplicates, createEntry } from '../../api.jsx';
import { isUrl, inferSourceFromUrl, URL_SCRAPE_SOURCES, onCoverError } from '../../utils.jsx';
import { SEARCH_SOURCES, SOURCE_LABEL, loadSavedSources, saveSources, resultToEntry } from './searchSources.js';
import EntryForm, { formToPayload } from './EntryForm.jsx';
import ConfirmEntryModal from './ConfirmEntryModal.jsx';
import ExtensionInstallHint from './ExtensionInstallHint.jsx';
import { Tabs, SelectRow } from './terminal.jsx';
import { useExtensionPresent, extensionNuSearch, mergeResults } from '../../extensionBridge.js';

export default function AddEntryModal({ onClose, onCreated, initialEntry = null, initialTab = 'search', hideTabs = false }) {
  const [tab,             setTab]             = useState(initialTab);
  const [query,           setQuery]           = useState('');
  const [selectedSources, setSelectedSources] = useState(() => loadSavedSources());
  const [extended,        setExtended]        = useState(false);
  const [searching,       setSearching]       = useState(false);
  const [results,         setResults]         = useState(null);
  const [inLibrary,       setInLibrary]       = useState([]);
  const [searchErr,       setSearchErr]       = useState('');
  const [selected,        setSelected]        = useState(new Set());
  const [confirmQueue,    setConfirmQueue]     = useState([]);
  const [nuSearching,     setNuSearching]      = useState(false);
  const extPresent = useExtensionPresent();

  const nuRequested = selectedSources.size === 0 || selectedSources.has('novelupdates');

  async function runDupCheck(list) {
    if (!list.length) { setInLibrary([]); return; }
    try {
      const check = await checkDuplicates(
        list.map(r => ({ title: r.title, year: r.year ?? null, medium: r.medium ?? null }))
      );
      setInLibrary(check.exists);
    } catch (_) { /* non-critical */ }
  }

  function toggleSource(value) {
    setSelectedSources(prev => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      saveSources(next);
      return next;
    });
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setSearchErr(''); setResults(null); setInLibrary([]); setSelected(new Set());
    try {
      if (isUrl(query)) {
        // URL pasted: scrape the page backend-side, ignoring the source toggles,
        // and go straight to the confirm form for the single result.
        const src = inferSourceFromUrl(query.trim());
        if (!URL_SCRAPE_SOURCES.has(src)) {
          setSearchErr("URL import isn't supported for this site yet — try a title search or manual entry.");
          return;
        }
        const data = await fetchByUrl(query.trim());
        const found = Array.isArray(data) ? data : [];
        if (found.length === 0) {
          setSearchErr("Couldn't read that page — it may be unavailable or its layout changed. Try manual entry.");
          return;
        }
        setConfirmQueue(found.map(resultToEntry));
        return;
      }
      const data = await searchMedia(query.trim(), [...selectedSources], extended);
      let list = Array.isArray(data) ? data : data?.results ?? [];
      setResults(list);
      await runDupCheck(list);

      // Silent NovelUpdates fallback: NU keyword search is Cloudflare-blocked
      // server-side, so when the extension is present run it client-side and
      // merge the results in (progressively — backend results already showed).
      if (nuRequested && extPresent) {
        setNuSearching(true);
        try {
          const nu = await extensionNuSearch(query.trim());
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

  function toggleSelect(i) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function addSelected() {
    const queue = [...selected].sort((a, b) => a - b).map(i => resultToEntry(results[i]));
    setSelected(new Set());
    setConfirmQueue(queue);
  }

  function handleQueueSave(created) {
    onCreated(created);
  }

  function handleQueueComplete() {
    setConfirmQueue([]);
    onClose();
  }

  async function handleManualSubmit(form) {
    const created = await createEntry(formToPayload(form));
    onCreated(created);
    onClose();
  }

  const urlMode = isUrl(query);
  const detectedSource = urlMode ? inferSourceFromUrl(query.trim()) : '';

  if (confirmQueue.length > 0) {
    return (
      <ConfirmEntryModal
        queue={confirmQueue}
        onSave={handleQueueSave}
        onComplete={handleQueueComplete}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Add Entry</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {!hideTabs && (
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[{ key: 'search', label: 'Auto Search' }, { key: 'manual', label: 'Manual Entry' }]}
          />
        )}

        <div className="modal-body">
          {/* ── Auto-search tab ── */}
          {tab === 'search' && (
            <>
              <form onSubmit={handleSearch} className="add-search-form">
                <div className="add-search-bar">
                  <input
                    className="form-input"
                    placeholder="Title or paste a URL…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoFocus
                  />
                  <button className="btn" type="submit" disabled={searching || !query.trim()}>
                    {searching ? '…' : urlMode ? 'Import' : 'Search'}
                  </button>
                  {!urlMode && (
                    <button
                      type="button"
                      className={`icon-btn${extended ? ' is-on' : ''}`}
                      onClick={() => setExtended(x => !x)}
                      title="Return all results instead of top 10"
                    >
                      Extended
                    </button>
                  )}
                </div>
                {urlMode ? (
                  <div className="add-url-hint">
                    {URL_SCRAPE_SOURCES.has(detectedSource)
                      ? `Detected ${SOURCE_LABEL[detectedSource] ?? detectedSource} link — source toggles ignored`
                      : 'Paste a NovelUpdates, JJWXC, Qidian, or IMDb URL'}
                  </div>
                ) : (
                <div className="source-select">
                  <div className="source-select-head">
                    <span className="form-label">Sources</span>
                    {selectedSources.size > 0 && (
                      <button
                        type="button"
                        className="source-select-clear"
                        onClick={() => { setSelectedSources(new Set()); saveSources(new Set()); }}
                      >
                        ✕ Clear ({selectedSources.size})
                      </button>
                    )}
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
                  </div>
                </div>
                )}
              </form>

              {searchErr && <div className="modal-error">{searchErr}</div>}

              {results !== null && (
                results.length === 0
                  ? <div className="add-no-results">
                      {nuSearching ? <span className="loading-dots">Searching NovelUpdates</span> : 'No results — try manual entry.'}
                      {!nuSearching && nuRequested && !extPresent && (
                        <div className="add-no-results-hint"><ExtensionInstallHint context="search" /></div>
                      )}
                    </div>
                  : <>
                      <div className="picker-list">
                        {results.map((r, i) => {
                          const isSelected  = selected.has(i);
                          const isInLibrary = inLibrary[i];
                          return (
                            <SelectRow
                              key={i}
                              on={isSelected}
                              tone={!isSelected && isInLibrary ? 'muted' : undefined}
                              title={isInLibrary ? 'Already in your library' : undefined}
                              onClick={() => toggleSelect(i)}
                            >
                              <span className="add-result">
                                <span className="sr-cover">
                                  {(r.cover_url || r.cover) && (
                                    <img src={r.cover_url || r.cover} alt="" referrerPolicy="no-referrer" onError={onCoverError} />
                                  )}
                                </span>
                                <span className="add-result-info">
                                  <span className="sr-title">{r.title}</span>
                                  <span className="sr-meta">
                                    {[r.medium, r.year, r.origin].filter(Boolean).join(' · ')}
                                    {isInLibrary ? ' · in library' : ''}
                                  </span>
                                  {r.source && <span className="add-result-source">{SOURCE_LABEL[r.source] ?? r.source}</span>}
                                </span>
                              </span>
                            </SelectRow>
                          );
                        })}
                      </div>
                      {nuSearching && (
                        <div className="add-nu-note"><span className="loading-dots">Searching NovelUpdates</span></div>
                      )}
                      <div className="add-results-foot">
                        <span className="add-legend">[X] selected · <span className="add-legend-lib">[ ]</span> already in library</span>
                        <button className="btn" onClick={addSelected} disabled={selected.size === 0}>
                          Add Selected ({selected.size})
                        </button>
                      </div>
                    </>
              )}

            </>
          )}

          {tab === 'manual' && (
            <EntryForm
              entry={initialEntry}
              onCancel={() => initialTab === 'manual' ? onClose() : setTab('search')}
              onSubmit={handleManualSubmit}
              submitLabel="Add Entry"
            />
          )}

        </div>
      </div>
    </div>
  );
}
