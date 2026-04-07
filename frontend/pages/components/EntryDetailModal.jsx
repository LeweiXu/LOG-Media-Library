import { useState } from 'react';
import { updateEntry, deleteEntry } from '../../api.jsx';
import { MEDIUMS, STATUSES, statusLabel, fmtDate, progressLabel, inferSourceFromUrl } from '../../utils.jsx';

function toDateInput(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

export default function EntryDetailModal({ entry, onClose, onUpdated, onDeleted, initialEditing = false }) {
  const [editing,       setEditing]       = useState(initialEditing);
  const [current,       setCurrent]       = useState(entry);
  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [err,           setErr]           = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [form, setForm] = useState({
    title:        entry.title        || '',
    medium:       entry.medium       || '',
    origin:       entry.origin       || '',
    status:       entry.status       || 'planned',
    year:         entry.year         || '',
    rating:       entry.rating       ?? '',
    progress:     entry.progress     ?? '',
    total:        entry.total        ?? '',
    cover_url:    entry.cover_url    || '',
    notes:        entry.notes        || '',
    completed_at: toDateInput(entry.completed_at),
    external_url: entry.external_url || '',
    source:       entry.source       || '',
  });

  const setField = (k, v) => setForm(f => {
    const next = { ...f, [k]: v };
    if (k === 'status' && v === 'completed') {
      if (!next.completed_at) next.completed_at = new Date().toISOString().slice(0, 10);
      if (next.total !== '') next.progress = next.total;
    }
    if (k === 'status' && v !== 'completed') next.completed_at = '';
    if (k === 'total' && f.status === 'completed' && v !== '') next.progress = v;
    if (k === 'external_url') next.source = inferSourceFromUrl(v);
    return next;
  });

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const payload = {
        ...form,
        year:         form.year         !== '' ? parseInt(form.year)          : null,
        rating:       form.rating       !== '' ? parseFloat(form.rating)      : null,
        progress:     form.progress     !== '' ? parseInt(form.progress)      : null,
        total:        form.total        !== '' ? parseInt(form.total)         : null,
        completed_at: form.completed_at ? form.completed_at + 'T00:00:00Z'   : null,
      };
      const updated = await updateEntry(current.id, payload);
      onUpdated(updated);
      onClose();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true); setErr('');
    try {
      await deleteEntry(current.id);
      onDeleted(current.id);
      onClose();
    } catch (ex) {
      setErr(ex.message);
      setDeleting(false);
    }
  }

  function enterEdit() {
    // Sync form state with latest current data before entering edit mode
    setForm({
      title:        current.title        || '',
      medium:       current.medium       || '',
      origin:       current.origin       || '',
      status:       current.status       || 'planned',
      year:         current.year         || '',
      rating:       current.rating       ?? '',
      progress:     current.progress     ?? '',
      total:        current.total        ?? '',
      cover_url:    current.cover_url    || '',
      notes:        current.notes        || '',
      completed_at: toDateInput(current.completed_at),
      external_url: current.external_url || '',
      source:       current.source       || '',
    });
    setErr('');
    setConfirmDelete(false);
    setEditing(true);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{current.title}</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {!editing ? (
            /* ── View mode ── */
            <div>
              {current.cover_url && (
                <div style={{ textAlign: 'center', marginBottom: 14 }}>
                  <img src={current.cover_url} alt=""
                    style={{ maxHeight: 320, borderRadius: 4, objectFit: 'cover' }}
                    onError={e => { e.target.style.display = 'none'; }} />
                </div>
              )}

              <div className="form-row-2" style={{ marginBottom: 10 }}>
                <div>
                  <div className="form-label">Medium</div>
                  <div>{current.medium || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Status</div>
                  <div><span className={`badge badge-${current.status}`}>{statusLabel(current.status)}</span></div>
                </div>
              </div>

              <div className="form-row-2" style={{ marginBottom: 10 }}>
                <div>
                  <div className="form-label">Origin</div>
                  <div>{current.origin || '—'}</div>
                </div>
                <div>
                  <div className="form-label">Year</div>
                  <div>{current.year || '—'}</div>
                </div>
              </div>

              <div className="form-row-2" style={{ marginBottom: 10 }}>
                <div>
                  <div className="form-label">Progress</div>
                  <div>{progressLabel(current)}</div>
                </div>
                <div>
                  <div className="form-label">Rating</div>
                  <div>{current.rating != null ? `${current.rating}/10` : '—'}</div>
                </div>
              </div>

              {(current.genres || current.external_rating != null) && (
                <div className="form-row-2" style={{ marginBottom: 10 }}>
                  <div>
                    <div className="form-label">Genres</div>
                    <div style={{ fontSize: 12 }}>{current.genres || '—'}</div>
                  </div>
                  <div>
                    <div className="form-label">Source Rating</div>
                    <div>{current.external_rating != null ? `${current.external_rating}/10` : '—'}</div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <div className="form-label">Completed Date</div>
                <div>{fmtDate(current.completed_at)}</div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <div className="form-label">Notes</div>
                <div style={{ whiteSpace: 'pre-wrap', color: 'var(--dim)', fontSize: 12 }}>
                  {current.notes || '—'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>
                <span>Added: {fmtDate(current.created_at)}</span>
                <span>Updated: {fmtDate(current.updated_at)}</span>
              </div>

              {current.external_url && (
                <div style={{ marginBottom: 14, fontSize: 11 }}>
                  <a href={current.external_url} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', textDecoration: 'none' }}
                    onMouseOver={e => e.target.style.textDecoration = 'underline'}
                    onMouseOut={e => e.target.style.textDecoration = 'none'}>
                    External Source ↗
                  </a>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
                <button type="button" className="btn" onClick={enterEdit}>Edit</button>
              </div>
            </div>
          ) : (
            /* ── Edit mode ── */
            <form onSubmit={handleSave}>
              <div className="form-row">
                <label className="form-label">Title</label>
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
                  <input className="form-input" value={form.origin}
                    onChange={e => setField('origin', e.target.value)} />
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
                  <input className="form-input" type="number" min="0" value={form.progress}
                    onChange={e => setField('progress', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Total</label>
                  <input className="form-input" type="number" min="0" value={form.total}
                    onChange={e => setField('total', e.target.value)} />
                </div>
              </div>

              <div className="form-row">
                <label className="form-label">Rating (0–10)</label>
                <input className="form-input" type="number" min="0" max="10" step="0.1"
                  value={form.rating} onChange={e => setField('rating', e.target.value)} />
              </div>

              <div className="form-row">
                <label className="form-label">Cover URL</label>
                <input className="form-input" value={form.cover_url}
                  onChange={e => setField('cover_url', e.target.value)} />
              </div>

              <div className="form-row">
                <label className="form-label">Source URL</label>
                <input className="form-input" value={form.external_url}
                  placeholder="https://novelupdates.com/series/…"
                  onChange={e => setField('external_url', e.target.value)} />
                {form.source && (
                  <span style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3 }}>
                    Source: {form.source}
                  </span>
                )}
              </div>

              <div className="form-row">
                <label className="form-label">Notes</label>
                <textarea className="form-input" rows={2} value={form.notes}
                  onChange={e => setField('notes', e.target.value)} style={{ resize: 'vertical' }} />
              </div>

              {err && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{err}</div>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 4 }}>
                <div>
                  {!confirmDelete
                    ? <button type="button" className="icon-btn danger" onClick={() => setConfirmDelete(true)}>
                        Delete
                      </button>
                    : <span style={{ fontSize: 11, color: 'var(--red)', display: 'flex', gap: 8, alignItems: 'center' }}>
                        Confirm?
                        <button type="button" className="btn btn-danger"
                          style={{ padding: '3px 10px', fontSize: 11 }}
                          onClick={handleDelete} disabled={deleting}>
                          {deleting ? '…' : 'Yes, delete'}
                        </button>
                        <button type="button" className="icon-btn" onClick={() => setConfirmDelete(false)}>No</button>
                      </span>
                  }
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-outline" onClick={() => setEditing(false)}>Cancel</button>
                  <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
