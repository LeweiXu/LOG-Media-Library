import { useState } from 'react';
import { searchMedia, createEntry, checkDuplicates } from '../../api.jsx';
import { MEDIUMS, STATUSES, statusLabel, inferSourceFromUrl } from '../../utils.jsx';
import ConfirmEntryModal from './ConfirmEntryModal.jsx';

export default function AddEntryModal({ onClose, onCreated }) {
  const [tab,          setTab]          = useState('search');
  const [query,        setQuery]        = useState('');
  const [source,       setSource]       = useState('');
  const [searching,    setSearching]    = useState(false);
  const [results,      setResults]      = useState(null);
  const [inLibrary,    setInLibrary]    = useState([]);
  const [searchErr,    setSearchErr]    = useState('');
  const [saving,       setSaving]       = useState(false);
  const [saveErr,      setSaveErr]      = useState('');
  const [selected,     setSelected]     = useState(new Set());
  const [confirmQueue, setConfirmQueue] = useState([]);

  const [form, setForm] = useState({
    title: '', medium: '', origin: '', status: 'current',
    year: '', rating: '', progress: '', total: '', cover_url: '', notes: '',
    completed_at: '', external_url: '', genres: '', external_rating: '',
  });

  const today = () => new Date().toISOString().slice(0, 10);

  const setField = (k, v) => setForm(f => {
    const next = { ...f, [k]: v };
    if (k === 'status' && v === 'completed') {
      if (!next.completed_at) next.completed_at = today();
      if (next.total !== '') next.progress = next.total;
    }
    if (k === 'status' && v !== 'completed') next.completed_at = '';
    if (k === 'total' && f.status === 'completed' && v !== '') next.progress = v;
    if (k === 'external_url') next.source = inferSourceFromUrl(v);
    return next;
  });

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true); setSearchErr(''); setResults(null); setInLibrary([]); setSelected(new Set());
    try {
      const data = await searchMedia(query.trim(), source);
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

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title.trim()) { setSaveErr('Title is required'); return; }
    setSaving(true); setSaveErr('');
    try {
      const payload = {
        ...form,
        year:         form.year         !== '' ? parseInt(form.year)       : undefined,
        rating:       form.rating       !== '' ? parseFloat(form.rating)   : undefined,
        progress:        form.progress        !== '' ? parseInt(form.progress)          : undefined,
        total:           form.total           !== '' ? parseInt(form.total)             : undefined,
        completed_at:    form.completed_at    ? form.completed_at + 'T00:00:00Z'        : undefined,
        external_rating: form.external_rating !== '' ? parseFloat(form.external_rating) : undefined,
      };
      const created = await createEntry(payload);
      onCreated(created);
      onClose();
    } catch (err) {
      setSaveErr(err.message);
    } finally {
      setSaving(false);
    }
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
              <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Title…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  autoFocus
                />
                <select
                  className="form-input"
                  style={{ width: 150 }}
                  value={source}
                  onChange={e => setSource(e.target.value)}
                >
                  <option value="">Any source</option>
                  <option value="tmdb">TMDB (Film &amp; TV)</option>
                  <option value="anilist">AniList (Anime &amp; Manga)</option>
                  <option value="jikan">MyAnimeList (Anime &amp; Manga)</option>
                  <option value="kitsu">Kitsu (Anime &amp; Manga)</option>
                  <option value="novelupdates">NovelUpdates (Novels)</option>
                  <option value="mangadex">MangaDex (Manga)</option>
                  <option value="igdb">IGDB (Games)</option>
                  <option value="rawg">RAWG (Games)</option>
                  <option value="google_books">Google Books</option>
                  <option value="open_library">Open Library</option>
                  <option value="comicvine">ComicVine (Comics)</option>
                  <option value="vndb">VNDB (Visual Novels)</option>
                </select>
                <button className="btn" type="submit" disabled={searching || !query.trim()}>
                  {searching ? '…' : 'Search'}
                </button>
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

              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <button className="icon-btn" onClick={() => setTab('manual')}>
                  Skip to manual entry →
                </button>
              </div>
            </>
          )}

          {/* ── Manual entry tab ── */}
          {tab === 'manual' && (
            <form onSubmit={handleSave}>
              <div className="form-row">
                <label className="form-label">Title *</label>
                <input className="form-input" value={form.title} placeholder="Title"
                  onChange={e => setField('title', e.target.value)} />
              </div>

              <div className="form-row-2" style={{ marginBottom: 14 }}>
                <div>
                  <label className="form-label">Medium</label>
                  <select className="form-input" value={form.medium} onChange={e => setField('medium', e.target.value)}>
                    <option value="">—</option>
                    {MEDIUMS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Status</label>
                  <select className="form-input" value={form.status} onChange={e => setField('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                </div>
              </div>

              {form.status === 'completed' && (
                <div className="form-row" style={{ marginBottom: 14 }}>
                  <label className="form-label">Completed Date</label>
                  <input className="form-input" type="date" value={form.completed_at}
                    onChange={e => setField('completed_at', e.target.value)} />
                </div>
              )}

              <div className="form-row-2" style={{ marginBottom: 14 }}>
                <div>
                  <label className="form-label">Origin</label>
                  <input className="form-input" value={form.origin} placeholder="Japanese, Korean…"
                    onChange={e => setField('origin', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Year</label>
                  <input className="form-input" type="number" value={form.year} placeholder="2024"
                    onChange={e => setField('year', e.target.value)} />
                </div>
              </div>

              <div className="form-row-2" style={{ marginBottom: 14 }}>
                <div>
                  <label className="form-label">Progress</label>
                  <input className="form-input" type="number" value={form.progress} placeholder="0"
                    onChange={e => setField('progress', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Total</label>
                  <input className="form-input" type="number" value={form.total} placeholder="12"
                    onChange={e => setField('total', e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <label className="form-label">Rating (0–10)</label>
                <input className="form-input" type="number" min="0" max="10" step="0.1"
                  value={form.rating} placeholder="—" onChange={e => setField('rating', e.target.value)} />
              </div>

              <div className="form-row">
                <label className="form-label">Cover URL</label>
                <input className="form-input" value={form.cover_url} placeholder="https://…"
                  onChange={e => setField('cover_url', e.target.value)} />
              </div>

              <div className="form-row">
                <label className="form-label">Source URL</label>
                <input className="form-input" value={form.external_url} placeholder="https://novelupdates.com/series/…"
                  onChange={e => setField('external_url', e.target.value)} />
                {form.source && (
                  <span style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3 }}>
                    Source: {form.source}
                  </span>
                )}
              </div>

              <div className="form-row">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={2} value={form.notes} placeholder="Optional notes…"
                  onChange={e => setField('notes', e.target.value)} style={{ resize: 'vertical' }} />
              </div>

              {saveErr && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{saveErr}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? 'Saving…' : 'Save Entry'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
