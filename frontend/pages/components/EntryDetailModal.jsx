import { useState } from 'react';
import { deleteEntry } from '../../api.jsx';
import { statusLabel, fmtDate, progressLabel } from '../../utils.jsx';
import EntryFormModal from './EntryFormModal.jsx';

function cleanUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}

export default function EntryDetailModal({ entry, onClose, onUpdated, onDeleted, initialEditing = false }) {
  const [editing,         setEditing]         = useState(initialEditing);
  const [current,         setCurrent]         = useState(entry);
  const [confirmDelete,   setConfirmDelete]   = useState(false);
  const [deleting,        setDeleting]        = useState(false);
  const [deleteError,     setDeleteError]     = useState('');

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteEntry(current.id);
      onDeleted?.(current.id);
      onClose();
    } catch (err) {
      setDeleteError(err.message || String(err));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (editing) {
    return (
      <EntryFormModal
        entry={current}
        onClose={() => setEditing(false)}
        onSaved={(updated) => { setCurrent(updated); onUpdated(updated); setEditing(false); }}
        onDeleted={(id) => { onDeleted(id); onClose(); }}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">{current.title}</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
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

          {current.completed_at && (
            <div style={{ marginBottom: 10 }}>
              <div className="form-label">Completed Date</div>
              <div>{fmtDate(current.completed_at)}</div>
            </div>
          )}

          {current.notes && (
            <div style={{ marginBottom: 10 }}>
              <div className="form-label">Notes</div>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--dim)', fontSize: 12 }}>
                {current.notes}
              </div>
            </div>
          )}

          {current.external_url && (
            <div style={{ marginBottom: 10 }}>
              <div className="form-label">External Source</div>
              <a href={current.external_url} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12, wordBreak: 'break-all' }}
                onMouseOver={e => e.target.style.textDecoration = 'underline'}
                onMouseOut={e => e.target.style.textDecoration = 'none'}>
                {cleanUrl(current.external_url)}
              </a>
            </div>
          )}

          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>
            <span>Added: {fmtDate(current.created_at)}</span>
            <span>Updated: {fmtDate(current.updated_at)}</span>
          </div>

          {deleteError && (
            <div className="settings-msg settings-msg-error" style={{ marginBottom: 8 }}>
              {deleteError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            {confirmDelete ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--red)' }}>delete this entry?</span>
                <button type="button" className="btn btn-danger"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={handleDelete} disabled={deleting}>
                  {deleting ? '…' : 'yes'}
                </button>
                <button type="button" className="icon-btn"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  no
                </button>
              </div>
            ) : (
              <button type="button" className="icon-btn danger"
                style={{ padding: '4px 10px', fontSize: 11 }}
                onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
              <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
