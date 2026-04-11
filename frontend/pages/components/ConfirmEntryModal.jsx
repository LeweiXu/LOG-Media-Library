import { useState } from 'react';
import { createEntry } from '../../api.jsx';
import { MEDIUMS, ORIGINS, STATUSES, statusLabel, inferSourceFromUrl } from '../../utils.jsx';

function entryToForm(e) {
  return {
    title:           e.title           || '',
    medium:          e.medium          || '',
    origin:          e.origin          || '',
    status:          e.status          || 'current',
    year:            e.year            || '',
    rating:          e.rating          ?? '',
    progress:        e.progress        ?? '',
    total:           e.total           ?? '',
    cover_url:       e.cover_url       || '',
    notes:           e.notes           || '',
    external_url:    e.external_url    || '',
    source:          e.source          || '',
    external_id:     e.external_id     || '',
    genres:          e.genres          || '',
    external_rating: e.external_rating ?? '',
    completed_at:    '',
  };
}

function formToPayload(f) {
  return {
    ...f,
    year:            f.year            !== '' ? parseInt(f.year)               : undefined,
    rating:          f.rating          !== '' ? parseFloat(f.rating)           : undefined,
    progress:        f.progress        !== '' ? parseInt(f.progress)           : undefined,
    total:           f.total           !== '' ? parseInt(f.total)              : undefined,
    external_rating: f.external_rating !== '' ? parseFloat(f.external_rating) : undefined,
    completed_at:    f.completed_at    ? f.completed_at + 'T00:00:00Z'        : undefined,
  };
}

export default function ConfirmEntryModal({ queue, onSave, onComplete }) {
  const [index,     setIndex]     = useState(0);
  const [form,      setForm]      = useState(() => entryToForm(queue[0]));
  const [collected, setCollected] = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [err,       setErr]       = useState('');

  const total  = queue.length;
  const isLast = index === total - 1;

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

  async function submitAll(forms) {
    setSaving(true); setErr('');
    try {
      for (const f of forms) {
        const created = await createEntry(formToPayload(f));
        onSave(created);
      }
      onComplete();
    } catch (e) {
      setErr(e.message);
      setSaving(false);
    }
  }

  // "Next": validate, collect current form, advance without submitting
  function handleNext() {
    if (!form.title.trim()) { setErr('Title is required'); return; }
    const next = index + 1;
    setCollected(prev => [...prev, form]);
    setIndex(next);
    setForm(entryToForm(queue[next]));
    setErr('');
  }

  // "Save" (last entry): collect current form and submit all at once
  async function handleSave() {
    if (!form.title.trim()) { setErr('Title is required'); return; }
    await submitAll([...collected, form]);
  }

  // "Discard": skip current entry; if last, submit whatever was already collected
  async function handleDiscard() {
    if (isLast) {
      if (collected.length > 0) {
        await submitAll(collected);
      } else {
        onComplete();
      }
    } else {
      const next = index + 1;
      setIndex(next);
      setForm(entryToForm(queue[next]));
      setErr('');
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Confirm Entry — {index + 1} of {total}</span>
          <button className="icon-btn" onClick={onComplete}>✕</button>
        </div>

        <div className="modal-body">
          <form onSubmit={e => e.preventDefault()}>
            <div className="form-row">
              <label className="form-label">Title *</label>
              <input className="form-input" value={form.title}
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
                <select className="form-input" value={form.origin} onChange={e => setField('origin', e.target.value)}>
                  <option value="">—</option>
                  {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Year</label>
                <input className="form-input" type="number" value={form.year}
                  onChange={e => setField('year', e.target.value)} />
              </div>
            </div>

            <div className="form-row-2" style={{ marginBottom: 14 }}>
              <div>
                <label className="form-label">Progress</label>
                <input className="form-input" type="number" value={form.progress}
                  onChange={e => setField('progress', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Total</label>
                <input className="form-input" type="number" value={form.total}
                  onChange={e => setField('total', e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <label className="form-label">Rating (0–10)</label>
              <input className="form-input" type="number" min="0" max="10" step="0.5"
                value={form.rating} onChange={e => setField('rating', e.target.value)} />
            </div>

            <div className="form-row">
              <label className="form-label">Cover URL</label>
              <input className="form-input" value={form.cover_url}
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
              <label className="form-label">Genres</label>
              <input className="form-input" value={form.genres}
                placeholder="e.g. Action, Comedy, Drama"
                onChange={e => setField('genres', e.target.value)}
                onBlur={e => setField('genres', e.target.value.split(',').map(s => s.trim()).filter(Boolean).join(', '))}
              />
            </div>

            <div className="form-row">
              <label className="form-label">Notes</label>
              <textarea className="form-input" rows={2} value={form.notes}
                onChange={e => setField('notes', e.target.value)} style={{ resize: 'vertical' }} />
            </div>

            {err && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
              <button type="button" className="btn btn-outline" onClick={handleDiscard} disabled={saving}>
                Discard
              </button>
              {isLast ? (
                <button type="button" className="btn" onClick={handleSave} disabled={saving}>
                  {saving ? '…' : 'Save'}
                </button>
              ) : (
                <button type="button" className="btn" onClick={handleNext} disabled={saving}>
                  Next
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
