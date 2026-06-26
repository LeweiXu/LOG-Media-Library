import { useState } from 'react';
import { deleteEntry } from '../../api.jsx';
import { statusLabel, fmtDate, progressLabel, onCoverError } from '../../utils.jsx';
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
            <div className="entry-detail-cover-wrap">
              <img src={current.cover_url} alt=""
                referrerPolicy="no-referrer"
                className="entry-detail-cover"
                onError={onCoverError} />
            </div>
          )}

          <div className="form-row-2 entry-detail-row">
            <div>
              <div className="form-label">Medium</div>
              <div>{current.medium || '—'}</div>
            </div>
            <div>
              <div className="form-label">Status</div>
              <div><span className={`badge badge-${current.status}`}>{statusLabel(current.status)}</span></div>
            </div>
          </div>

          <div className="form-row-2 entry-detail-row">
            <div>
              <div className="form-label">Origin</div>
              <div>{current.origin || '—'}</div>
            </div>
            <div>
              <div className="form-label">Year</div>
              <div>{current.year || '—'}</div>
            </div>
          </div>

          <div className="form-row-2 entry-detail-row">
            <div>
              <div className="form-label">Progress</div>
              <div>{progressLabel(current)}</div>
            </div>
            <div>
              <div className="form-label">Rating</div>
              <div>{current.rating != null ? `${current.rating}/10` : '—'}</div>
            </div>
          </div>

          <div className="entry-detail-row">
            <div className="form-label">Custom List</div>
            <div>{current.custom_list || '—'}</div>
          </div>

          {(current.genres || current.external_rating != null) && (
            <div className="form-row-2 entry-detail-row">
              <div>
                <div className="form-label">Genres</div>
                <div className="entry-detail-small">{current.genres || '—'}</div>
              </div>
              <div>
                <div className="form-label">Source Rating</div>
                <div>{current.external_rating != null ? `${current.external_rating}/10` : '—'}</div>
              </div>
            </div>
          )}

          {current.completed_at && (
            <div className="entry-detail-row">
              <div className="form-label">Completed Date</div>
              <div>{fmtDate(current.completed_at)}</div>
            </div>
          )}

          {current.notes && (
            <div className="entry-detail-row">
              <div className="form-label">Notes</div>
              <div className="entry-detail-notes">
                {current.notes}
              </div>
            </div>
          )}

          {current.external_url && (
            <div className="entry-detail-row">
              <div className="form-label">External Source</div>
              <a href={current.external_url} target="_blank" rel="noopener noreferrer"
                className="entry-detail-external">
                {cleanUrl(current.external_url)}
              </a>
            </div>
          )}

          <div className="entry-detail-timestamps">
            <span>Added: {fmtDate(current.created_at)}</span>
            <span>Updated: {fmtDate(current.updated_at)}</span>
          </div>

          {deleteError && (
            <div className="settings-msg settings-msg-error entry-detail-error">
              {deleteError}
            </div>
          )}
          <div className="entry-detail-actions">
            {confirmDelete ? (
              <div className="entry-detail-confirm">
                <span className="confirm-inline-text">sure?</span>
                <button type="button" className="btn btn-danger"
                  onClick={handleDelete} disabled={deleting}>
                  {deleting ? '…' : 'Yes, delete'}
                </button>
                <button type="button" className="btn btn-outline"
                  onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-danger-outline"
                onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
            <div className="entry-detail-primary-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
              <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
