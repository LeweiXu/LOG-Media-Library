import { useEffect, useState } from 'react';
import { getCustomLists, fetchChapterCount } from '../../api.jsx';
import { MEDIUMS, ORIGINS, STATUSES, statusLabel, inferSourceFromUrl } from '../../utils.jsx';
import CustomListField from './CustomListField.jsx';

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
    custom_list:     entry?.custom_list     || '',
  };
}

export function formToPayload(form, { isEdit = false } = {}) {
  const customList = (form.custom_list || '').trim();
  return {
    ...form,
    year:            form.year            !== '' ? parseInt(form.year)            : (isEdit ? null : undefined),
    rating:          form.rating          !== '' ? parseFloat(form.rating)        : (isEdit ? null : undefined),
    progress:        form.progress        !== '' ? parseInt(form.progress)        : (isEdit ? null : undefined),
    total:           form.total           !== '' ? parseInt(form.total)           : (isEdit ? null : undefined),
    external_rating: form.external_rating !== '' ? parseFloat(form.external_rating) : (isEdit ? null : undefined),
    completed_at:    form.completed_at    ? form.completed_at + 'T00:00:00Z'     : (isEdit ? null : undefined),
    custom_list:     customList !== '' ? customList                         : (isEdit ? null : undefined),
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
  const [customLists, setCustomLists] = useState([]);
  const [lastListWarning, setLastListWarning] = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [err,           setErr]           = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setField = (k, v) => {
    if (k === 'custom_list') setLastListWarning(false);
    setFormState(f => {
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
  };

  useEffect(() => {
    let cancelled = false;
    getCustomLists()
      .then(lists => { if (!cancelled) setCustomLists(Array.isArray(lists) ? lists : []); })
      .catch(() => { if (!cancelled) setCustomLists([]); });
    return () => { cancelled = true; };
  }, []);

  // For a MAL/Jikan manga being added with no chapter total (MAL leaves ongoing
  // series blank), fetch the latest chapter count from MangaUpdates on demand.
  useEffect(() => {
    if (isEdit) return;
    if (entry?.source !== 'jikan' || entry?.medium !== 'Manga' || entry?.total) return;
    if (!entry?.title) return;
    let cancelled = false;
    fetchChapterCount(entry.title)
      .then(res => {
        const total = res?.total;
        if (!cancelled && total) {
          setFormState(f => (f.total === '' ? { ...f, total: String(total) } : f));
        }
      })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, []);

  function isRemovingLastEntryFromList(nextList) {
    const currentList = entry?.custom_list || '';
    if (!isEdit || !currentList || currentList === nextList) return false;
    const currentMeta = customLists.find(list => list.name === currentList);
    return currentMeta?.count === 1;
  }

  async function submitForm(skipWarning = false) {
    if (!form.title.trim()) { setErr('Title is required'); return; }
    const nextList = (form.custom_list || '').trim();
    if (isRemovingLastEntryFromList(nextList) && !skipWarning) {
      setLastListWarning(true);
      setErr('');
      return;
    }
    setSaving(true); setErr('');
    setLastListWarning(false);
    try {
      await onSubmit(form);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    await submitForm(false);
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
    <>
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

      <div className="form-row" style={{ marginBottom: 14 }}>
        <label className="form-label">Custom List</label>
        <CustomListField
          value={form.custom_list}
          onChange={v => setField('custom_list', v)}
          lists={customLists}
        />
      </div>

      {form.status === 'completed' && (
        <div className="form-row" style={{ marginBottom: 14 }}>
          <label className="form-label">Completed Date</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" type="date" value={form.completed_at}
              style={{ flex: 1 }}
              onChange={e => setField('completed_at', e.target.value)} />
            <button
              type="button"
              className="icon-btn"
              style={{ padding: '5px 10px' }}
              title="Randomize day and month, keep year"
              onClick={() => {
                // Year comes from the existing value if present, otherwise the
                // entry year, otherwise today.
                const existing = form.completed_at ? new Date(form.completed_at) : null;
                const year = (existing && !isNaN(existing))
                  ? existing.getFullYear()
                  : (parseInt(form.year, 10) || new Date().getFullYear());
                const month  = Math.floor(Math.random() * 12) + 1;             // 1–12
                const lastDay = new Date(year, month, 0).getDate();             // last day of that month
                const day    = Math.floor(Math.random() * lastDay) + 1;        // 1–lastDay
                const mm = String(month).padStart(2, '0');
                const dd = String(day).padStart(2, '0');
                setField('completed_at', `${year}-${mm}-${dd}`);
              }}
            >
              Randomize
            </button>
          </div>
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
            ? <button type="button" className="btn btn-danger-outline"
                onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            : <span style={{ fontSize: 11, color: 'var(--red)', display: 'flex', gap: 8, alignItems: 'center' }}>
                Confirm?
                <button type="button" className="btn btn-danger"
                  onClick={handleDelete} disabled={deleting}>
                  {deleting ? '...' : 'Yes, delete'}
                </button>
                <button type="button" className="btn btn-outline"
                  onClick={() => setConfirmDelete(false)}>
                  Cancel
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

    {lastListWarning && (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setLastListWarning(false)}>
        <div className="modal confirm-modal">
          <div className="modal-header">
            <span className="modal-title">Custom List Will Be Removed</span>
            <button className="icon-btn" onClick={() => setLastListWarning(false)}>✕</button>
          </div>
          <div className="modal-body">
            <p style={{ margin: '0 0 16px', color: 'var(--dim)', fontSize: 13 }}>
              "{entry.custom_list}" only contains this entry. Saving will remove the entry from that list, so the custom list will disappear.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-outline" type="button" onClick={() => setLastListWarning(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" type="button" onClick={() => submitForm(true)}>
                Save Anyway
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
