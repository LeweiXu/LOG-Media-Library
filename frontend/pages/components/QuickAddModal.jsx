import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getExplore, createEntry, getCustomLists } from '../../api.jsx';
import { MEDIUMS, STATUSES, RATING_OPTIONS, statusLabel, onCoverError } from '../../utils.jsx';
import CustomListField from './CustomListField.jsx';

// Large candidate pool so the queue keeps going as the user adds/skips.
const POOL_LIMIT = 120;
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

// Stable identity for an explore item (no DB id until added).
const keyOf = (it) => `${it.source || ''}:${it.external_id || it.title}`;

// Defaults tuned for backfilling already-consumed media: assume completed,
// and pre-fill progress from the total when known.
function defaultForm(item) {
  const total = item?.total != null && item.total !== '' ? String(item.total) : '';
  return {
    status:   'completed',
    rating:   '',
    progress: total,
    total,
    custom_list: '',
  };
}

/**
 * Quick-add / backfill modal. Walks the user through explore recommendations
 * (which already exclude library titles) one at a time, letting them stamp a
 * status / progress / rating / list and add — purpose-built for logging media
 * consumed before they started using the app.
 */
export default function QuickAddModal({ onClose, onCreated, medium: initialMedium = '' }) {
  // Multi-select medium filter. Empty set = all mediums.
  const [mediums, setMediums] = useState(() => new Set(initialMedium ? [initialMedium] : []));
  const [pool,     setPool]     = useState([]);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [seed,     setSeed]     = useState(() => newSeed());
  // Set on Reroll so the next fetch bypasses the server-side per-medium cache
  // (a new seed alone only reshuffles cached results).
  const [refresh,  setRefresh]  = useState(false);
  const [customLists, setCustomLists] = useState([]);

  const [form,    setForm]    = useState(() => defaultForm(null));
  const [saving,  setSaving]  = useState(false);
  const [addErr,  setAddErr]  = useState('');
  const [added,   setAdded]   = useState(0);
  const [skipped, setSkipped] = useState(0);

  const requestSeq = useRef(0);

  // Items left to act on: never in library, never already handled this session.
  const queue = useMemo(
    () => pool.filter(it => !it.in_library && !dismissed.has(keyOf(it))),
    [pool, dismissed],
  );
  const current = queue[0] || null;

  // Warm the browser cache with the next few covers so advancing the queue
  // swaps to an already-decoded image instead of briefly showing the old one.
  useEffect(() => {
    for (const it of queue.slice(0, 4)) {
      if (!it.cover_url) continue;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = it.cover_url;
    }
  }, [queue]);

  // ── Fetch a candidate pool (replace on medium/seed change) ────────────────
  // With multiple mediums selected we fan out per medium and merge so each one
  // gets real coverage; an empty selection pulls the mixed "all" pool.
  const fetchPool = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true); setError('');
    try {
      const targets = mediums.size ? [...mediums] : [''];
      const batches = await Promise.all(
        targets.map(m => getExplore({ medium: m, limit: POOL_LIMIT, seed, refresh }).catch(() => ({ items: [] }))),
      );
      if (seq !== requestSeq.current) return;
      const merged = [];
      const seen = new Set();
      for (const b of batches) {
        for (const it of (b.items || [])) {
          const k = keyOf(it);
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(it);
        }
      }
      setPool(merged);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e.message);
    } finally {
      if (seq === requestSeq.current) { setLoading(false); setRefresh(false); }
    }
  }, [mediums, seed, refresh]);

  useEffect(() => { fetchPool(); }, [fetchPool]);

  useEffect(() => {
    let cancelled = false;
    getCustomLists()
      .then(lists => { if (!cancelled) setCustomLists(Array.isArray(lists) ? lists : []); })
      .catch(() => { if (!cancelled) setCustomLists([]); });
    return () => { cancelled = true; };
  }, []);

  // Reset the per-card controls whenever the current item changes.
  const currentKey = current ? keyOf(current) : null;
  useEffect(() => {
    setForm(defaultForm(current));
    setAddErr('');
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (k, v) => setForm(f => {
    const next = { ...f, [k]: v };
    // Progress tracks completion: a completed entry is fully progressed (when a
    // total is known), and progress clears when leaving the completed status.
    if (k === 'status') {
      if (v === 'completed') next.progress = next.total;
      else next.progress = '';
    }
    if (k === 'total' && next.status === 'completed') next.progress = v;
    return next;
  });

  function toggleMedium(m) {
    setMediums(prev => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }

  function skip() {
    if (!current) return;
    setDismissed(prev => new Set(prev).add(currentKey));
    setSkipped(n => n + 1);
  }

  async function add() {
    if (!current || saving) return;
    setSaving(true); setAddErr('');
    try {
      await createEntry({
        title:           current.title  || '',
        medium:          current.medium || '',
        origin:          current.origin || '',
        status:          form.status,
        year:            current.year   || undefined,
        rating:          form.rating   !== '' ? parseFloat(form.rating)   : undefined,
        progress:        form.progress !== '' ? parseInt(form.progress)   : undefined,
        total:           form.total    !== '' ? parseInt(form.total)      : undefined,
        cover_url:       current.cover_url    || '',
        external_id:     current.external_id  || '',
        source:          current.source       || '',
        external_url:    current.external_url || '',
        genres:          current.genres       || '',
        external_rating: current.external_rating ?? undefined,
        custom_list:     form.custom_list || undefined,
      });
      setDismissed(prev => new Set(prev).add(currentKey));
      setAdded(n => n + 1);
      onCreated?.();
    } catch (e) {
      setAddErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Reroll — bypass the per-medium cache and reshuffle, just like the Explore
  // page's Reroll. Acts on the selected mediums (or all, when none selected).
  function reroll() {
    setRefresh(true);
    setSeed(newSeed());
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide quickadd-modal">
        <div className="modal-header">
          <span className="modal-title">Quick Add — backfill your library</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="source-select quickadd-mediums">
            <div className="source-select-head">
              <span className="form-label" style={{ marginBottom: 0 }}>
                Mediums
                {mediums.size > 0 && (
                  <button type="button" className="source-select-clear" style={{ marginLeft: 10 }}
                    onClick={() => setMediums(new Set())}>
                    ✕ Clear ({mediums.size})
                  </button>
                )}
              </span>
              <span className="quickadd-head-right">
                <span className="quickadd-tally">
                  {added} added · {skipped} skipped · {queue.length} queued
                </span>
                <button type="button" className="icon-btn" onClick={reroll} disabled={loading}
                  title="Pull a fresh batch of suggestions">Reroll</button>
              </span>
            </div>
            <div className="source-grid quickadd-medium-grid">
              {MEDIUMS.map(m => {
                const on = mediums.has(m);
                return (
                  <button key={m} type="button" className={`source-chip${on ? ' is-on' : ''}`}
                    onClick={() => toggleMedium(m)}>
                    <span className="source-box">{on ? '[x]' : '[ ]'}</span>
                    {m}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="state-block">
              <div className="state-title">Error</div>
              <div className="state-detail">{error}</div>
              <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={fetchPool}>Retry</button>
            </div>
          )}

          {!error && loading && (
            <div className="state-block">
              <div className="state-title"><span className="loading-dots">Loading suggestions</span></div>
            </div>
          )}

          {!error && !loading && !current && (
            <div className="state-block">
              <div className="state-title">Nothing left to add here.</div>
              <div className="state-detail">
                You've gone through every suggestion for the selected mediums. Pull
                a fresh batch or change the medium filter.
              </div>
              <button className="btn" style={{ marginTop: 12 }} onClick={reroll}>Load more</button>
            </div>
          )}

          {!error && !loading && current && (
            <>
              <div className="quickadd-card">
                <div className="quickadd-cover">
                  {current.cover_url
                    ? <img key={current.cover_url} src={current.cover_url} alt="" referrerPolicy="no-referrer" onError={onCoverError} />
                    : <div className="quickadd-cover-empty">—</div>}
                </div>
                <div className="quickadd-info">
                  {current.external_url
                    ? <a href={current.external_url} target="_blank" rel="noopener noreferrer" className="quickadd-title">{current.title}</a>
                    : <span className="quickadd-title">{current.title}</span>}
                  <div className="quickadd-meta">
                    {[current.medium, current.year, current.origin].filter(Boolean).join(' · ')}
                    {current.external_rating != null && (
                      <span className="quickadd-rating"> · ★ {current.external_rating.toFixed(1)}</span>
                    )}
                  </div>
                  {current.genres && <div className="quickadd-genres">{current.genres}</div>}
                  {current.description && <p className="quickadd-desc">{current.description}</p>}
                </div>
              </div>

              <div className="quickadd-controls">
                <div className="form-row" style={{ marginBottom: 14 }}>
                  <label className="form-label">Status</label>
                  <div className="quickadd-seg">
                    {STATUSES.map(s => (
                      <button
                        key={s}
                        type="button"
                        className={'quickadd-seg-btn status-' + s + (form.status === s ? ' is-on' : '')}
                        onClick={() => setField('status', s)}
                      >
                        {statusLabel(s)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-row" style={{ marginBottom: 14 }}>
                  <label className="form-label">Rating</label>
                  <div className="quickadd-seg quickadd-rating-seg">
                    {RATING_OPTIONS.map(n => {
                      const on = form.rating !== '' && Number(form.rating) === n;
                      // Clicking the active value clears it (rating is optional).
                      return (
                        <button
                          key={n}
                          type="button"
                          className={'quickadd-seg-btn' + (on ? ' is-on' : '')}
                          onClick={() => setField('rating', on ? '' : String(n))}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="form-row-3">
                  <div>
                    <label className="form-label">Progress</label>
                    <input className="form-input" type="number" min="0" value={form.progress}
                      placeholder="0" onChange={e => setField('progress', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Total</label>
                    <input className="form-input" type="number" min="0" value={form.total}
                      placeholder="—" onChange={e => setField('total', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Custom List</label>
                    <CustomListField
                      value={form.custom_list}
                      onChange={v => setField('custom_list', v)}
                      lists={customLists}
                    />
                  </div>
                </div>

                {addErr && <div className="quickadd-err">{addErr}</div>}
              </div>

              <div className="quickadd-actions">
                <button type="button" className="btn btn-outline" onClick={skip} disabled={saving}>
                  Skip
                </button>
                <button type="button" className="btn" onClick={add} disabled={saving}>
                  {saving ? 'Adding…' : 'Add & Next'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
