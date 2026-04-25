import { useState } from 'react';
import { searchMedia, checkDuplicates } from '../../api.jsx';
import { EntryForm } from './EntryFormModal.jsx';
import ConfirmEntryModal from './ConfirmEntryModal.jsx';

const SEARCH_SOURCES = [
  { value: 'tmdb',         label: 'TMDB' },
  { value: 'anilist',      label: 'AniList' },
  { value: 'jikan',        label: 'MyAnimeList' },
  { value: 'kitsu',        label: 'Kitsu' },
  { value: 'novelupdates', label: 'NovelUpdates' },
  { value: 'mangadex',     label: 'MangaDex' },
  { value: 'igdb',         label: 'IGDB' },
  { value: 'rawg',         label: 'RAWG' },
  { value: 'google_books', label: 'Google Books' },
  { value: 'open_library', label: 'Open Library' },
  { value: 'comicvine',    label: 'ComicVine' },
  { value: 'vndb',         label: 'VNDB' },
];

const SOURCE_LABEL = Object.fromEntries(SEARCH_SOURCES.map(s => [s.value, s.label]));

const LS_SOURCES_KEY = 'search_sources';

function loadSavedSources() {
  try {
    const raw = localStorage.getItem(LS_SOURCES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch (_) { /* ignore */ }
  return new Set();
}

function saveSources(set) {
  localStorage.setItem(LS_SOURCES_KEY, JSON.stringify([...set]));
}

export default function AddEntryModal({ onClose, onCreated }) {
  const [tab,             setTab]             = useState('search');
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

  function resultToEntry(item) {
    return {
      title:           item.title           || '',
      medium:          item.medium          || '',
      origin:          item.origin          || '',
      status:          'current',
      year:            item.year            || '',
      rating:          '',
      progress:        '',
      total:           item.total           || '',
      cover_url:       item.cover_url       || item.cover || '',
      notes:           '',
      external_id:     item.id              || item.external_id    || '',
      source:          item.source          || '',
      external_url:    item.external_url    || '',
      genres:          item.genres          || '',
      external_rating: item.external_rating ?? '',
    };
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

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <button style={tabStyle('search')} onClick={() => setTab('search')}>Auto Search</button>
          <button style={tabStyle('manual')} onClick={() => setTab('manual')}>Manual Entry</button>
        </div>

        <div className="modal-body">
          {/* ── Auto-search tab ── */}
          {tab === 'search' && (
            <>
              <form onSubmit={handleSearch} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
                    placeholder="Title…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoFocus
                  />
                  <button className="btn" type="submit" disabled={searching || !query.trim()}>
                    {searching ? '…' : 'Search'}
                  </button>
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
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--dim)', marginRight: 2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    Sources:
                  </span>
                  {SEARCH_SOURCES.map(s => {
                    const on = selectedSources.has(s.value);
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => toggleSource(s.value)}
                        style={{
                          fontSize: 10,
                          padding: '2px 7px',
                          borderRadius: 3,
                          border: '1px solid',
                          borderColor: on ? 'var(--accent)' : 'var(--border)',
                          background: on ? 'var(--accent)' : 'transparent',
                          color: on ? 'var(--bg)' : 'var(--dim)',
                          cursor: 'pointer',
                          letterSpacing: '0.03em',
                        }}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                  {selectedSources.size > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSelectedSources(new Set()); saveSources(new Set()); }}
                      style={{ fontSize: 10, padding: '2px 6px', background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer' }}
                    >
                      ✕ all
                    </button>
                  )}
                </div>
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
                                {(r.cover_url || r.cover) && <img src={r.cover_url || r.cover} alt="" />}
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
              entry={null}
              onCancel={() => setTab('search')}
              onSaved={(created) => { onCreated(created); onClose(); }}
            />
          )}

        </div>
      </div>
    </div>
  );
}
