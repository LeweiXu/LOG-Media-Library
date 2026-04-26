import { useState } from 'react';
import { MEDIUMS, ORIGINS, STATUSES, statusLabel, inferSourceFromUrl } from '../../utils.jsx';

function toDateInput(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

export function entryToForm(entry = null) {
  return {
    title:           entry?.title           || '',
    medium:          entry?.medium          || '',
    origin:          entry?.origin          || '',
    status:          entry?.status          || 'current',
    year:            entry?.year            || '',
    rating:          entry?.rating          ?? '',
    progress:        entry?.progress        ?? '',
    total:           entry?.total           ?? '',
    cover_url:       entry?.cover_url       || '',
    notes:           entry?.notes           || '',
    genres:          entry?.genres          || '',
    completed_at:    entry?.completed_at ? toDateInput(entry.completed_at) : entry?.status === 'completed' ? today() : '',
    external_url:    entry?.external_url    || '',
    source:          entry?.source          || '',
    external_id:     entry?.external_id     || '',
    external_rating: entry?.external_rating ?? '',
  };
}

export function formToPayload(form, { isEdit = false } = {}) {
  return {
    ...form,
    year:            form.year            !== '' ? parseInt(form.year)            : (isEdit ? null : undefined),
    rating:          form.rating          !== '' ? parseFloat(form.rating)        : (isEdit ? null : undefined),
    progress:        form.progress        !== '' ? parseInt(form.progress)        : (isEdit ? null : undefined),
    total:           form.total           !== '' ? parseInt(form.total)           : (isEdit ? null : undefined),
    external_rating: form.external_rating !== '' ? parseFloat(form.external_rating) : (isEdit ? null : undefined),
    completed_at:    form.completed_at    ? form.completed_at + 'T00:00:00Z'     : (isEdit ? null : undefined),
  };
}

export default function EntryForm({
  entry = null,
  onSubmit,
  onCancel,
  onDelete,
  submitLabel,
  savingLabel = 'Saving...',
  cancelLabel = 'Cancel',
  leftAction = null,
  showDelete = false,
}) {
  const isEdit = Boolean(entry?.id);
  const [form, setFormState] = useState(() => entryToForm(entry));
  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [err,           setErr]           = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setField = (k, v) => setFormState(f => {
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setErr('Title is required'); return; }
    setSaving(true); setErr('');
    try {
      await onSubmit(form);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true); setErr('');
    try {
      await onDelete(entry.id);
    } catch (ex) {
      setErr(ex.message);
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-row">
        <label className="form-label">Title *</label>
        <input className="form-input" value={form.title}
          placeholder="Title"
          onChange={e => setField('title', e.target.value)} />
      </div>

      <div className="form-row-2" style={{ marginBottom: 14 }}>
        <div>
          <label className="form-label">Medium</label>
          <select className="form-input" value={form.medium}
            onChange={e => setField('medium', e.target.value)}>
            <option value="">-</option>
            {MEDIUMS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Status</label>
          <select className="form-input" value={form.status}
            onChange={e => setField('status', e.target.value)}>
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
          <select className="form-input" value={form.origin}
            onChange={e => setField('origin', e.target.value)}>
            <option value="">-</option>
            {ORIGINS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="form-label">Year</label>
          <input className="form-input" type="number" value={form.year}
            placeholder="2024"
            onChange={e => setField('year', e.target.value)} />
        </div>
      </div>

      <div className="form-row-2" style={{ marginBottom: 14 }}>
        <div>
          <label className="form-label">Progress</label>
          <input className="form-input" type="number" min="0" value={form.progress}
            placeholder="0"
            onChange={e => setField('progress', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Total</label>
          <input className="form-input" type="number" min="0" value={form.total}
            placeholder="12"
            onChange={e => setField('total', e.target.value)} />
        </div>
      </div>

      <div className="form-row-2" style={{ marginBottom: 14 }}>
        <div>
          <label className="form-label">Rating (0-10)</label>
          <input className="form-input" type="number" min="0" max="10" step="0.1"
            value={form.rating} placeholder="-"
            onChange={e => setField('rating', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Source Rating</label>
          <input className="form-input" type="number" min="0" max="100" step="0.1"
            value={form.external_rating} placeholder="-"
            onChange={e => setField('external_rating', e.target.value)} />
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">Cover URL</label>
        <input className="form-input" value={form.cover_url}
          placeholder="https://..."
          onChange={e => setField('cover_url', e.target.value)} />
      </div>

      <div className="form-row">
        <label className="form-label">Source URL</label>
        <input className="form-input" value={form.external_url}
          placeholder="https://novelupdates.com/series/..."
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
          onBlur={e => setField('genres',
            e.target.value.split(',').map(s => s.trim()).filter(Boolean).join(', ')
          )}
        />
      </div>

      <div className="form-row">
        <label className="form-label">Notes</label>
        <textarea className="form-input" rows={2} value={form.notes}
          placeholder="Optional notes..."
          onChange={e => setField('notes', e.target.value)}
          style={{ resize: 'vertical' }} />
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
        <div>
          {showDelete && isEdit && (!confirmDelete
            ? <button type="button" className="icon-btn danger"
                onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            : <span style={{ fontSize: 11, color: 'var(--red)', display: 'flex', gap: 8, alignItems: 'center' }}>
                Confirm?
                <button type="button" className="btn btn-danger"
                  style={{ padding: '3px 10px', fontSize: 11 }}
                  onClick={handleDelete} disabled={deleting}>
                  {deleting ? '...' : 'Yes, delete'}
                </button>
                <button type="button" className="icon-btn"
                  onClick={() => setConfirmDelete(false)}>
                  No
                </button>
              </span>
          )}
          {!showDelete && leftAction}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onCancel && <button type="button" className="btn btn-outline" onClick={onCancel}>{cancelLabel}</button>}
          <button type="submit" className="btn" disabled={saving}>
            {saving ? savingLabel : submitLabel || (isEdit ? 'Save' : 'Add Entry')}
          </button>
        </div>
      </div>
    </form>
  );
}
