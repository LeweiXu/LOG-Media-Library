import { useState } from 'react';
import { searchMedia, fetchByUrl, checkDuplicates, createEntry } from '../../api.jsx';
import { isUrl, inferSourceFromUrl, URL_SCRAPE_SOURCES, onCoverError } from '../../utils.jsx';
import { SEARCH_SOURCES, SOURCE_LABEL, loadSavedSources, saveSources, resultToEntry } from './searchSources.js';
import EntryForm, { formToPayload } from './EntryForm.jsx';
import ConfirmEntryModal from './ConfirmEntryModal.jsx';

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
      const list = Array.isArray(data) ? data : data?.results ?? [];
      setResults(list);
      if (list.length > 0) {
        try {
          const check = await checkDuplicates(
            list.map(r => ({ title: r.title, year: r.year ?? null, medium: r.medium ?? null }))
          );
          setInLibrary(check.exists);
        } catch (_) { /* non-critical: ignore duplicate check errors */ }
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

  const tabStyle = (t) => ({
    background: 'none',
    border: 'none',
    borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
    color: tab === t ? 'var(--accent)' : 'var(--dim)',
    padding: '8px 18px',
    fontSize: '11px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    cursor: 'pointer',
  });

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
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            <button style={tabStyle('search')} onClick={() => setTab('search')}>Auto Search</button>
            <button style={tabStyle('manual')} onClick={() => setTab('manual')}>Manual Entry</button>
          </div>
        )}

        <div className="modal-body">
          {/* ── Auto-search tab ── */}
          {tab === 'search' && (
            <>
              <form onSubmit={handleSearch} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
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
                      className="icon-btn"
                      onClick={() => setExtended(x => !x)}
                      style={{
                        borderColor: extended ? 'var(--accent)' : undefined,
                        color: extended ? 'var(--accent)' : undefined,
                        padding: '5px 10px',
                      }}
                      title="Return all results instead of top 10"
                    >
                      Extended
                    </button>
                  )}
                </div>
                {urlMode ? (
                  <div style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: '0.03em', padding: '2px 0' }}>
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

              {searchErr && (
                <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 10 }}>{searchErr}</div>
              )}

              {results !== null && (
                results.length === 0
                  ? <div style={{ color: 'var(--dim)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
                      No results — try manual entry.
                    </div>
                  : <>
                      <div className="search-results">
                        {results.map((r, i) => {
                          const isSelected  = selected.has(i);
                          const isInLibrary = inLibrary[i];
                          const shadow = isSelected
                            ? 'inset 0 0 0 2px var(--accent)'
                            : isInLibrary
                            ? 'inset 0 0 0 2px var(--green)'
                            : undefined;
                          return (
                            <div
                              key={i}
                              className="search-result-item"
                              style={{ boxShadow: shadow }}
                              onClick={() => toggleSelect(i)}
                            >
                              <div className="sr-cover">
                                {(r.cover_url || r.cover) && (
                                  <img src={r.cover_url || r.cover} alt="" referrerPolicy="no-referrer" onError={onCoverError} />
                                )}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div className="sr-title">{r.title}</div>
                                <div className="sr-meta">
                                  {[r.medium, r.year, r.origin].filter(Boolean).join(' · ')}
                                </div>
                                {r.source && (
                                  <div style={{ fontSize: 10, color: 'var(--accent)', opacity: 0.7, marginTop: 1 }}>
                                    {SOURCE_LABEL[r.source] ?? r.source}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--dim)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, boxShadow: 'inset 0 0 0 2px var(--accent)', display: 'inline-block' }} />
                            Selected
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 2, boxShadow: 'inset 0 0 0 2px var(--green)', display: 'inline-block' }} />
                            Already in library
                          </span>
                        </div>
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
