import { useEffect, useState } from 'react';
import { clearCustomList, renameCustomList } from '../../api.jsx';

export default function ManageListsModal({
  onClose,
  onRenamed,
  onDeleted,
  existingLists = [],
}) {
  const [editNames, setEditNames] = useState({});
  const [confirmDelete, setConfirmDelete] = useState('');
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setEditNames(Object.fromEntries(existingLists.map(list => [list.name, list.name])));
  }, [existingLists]);

  async function handleRename(list) {
    const nextName = (editNames[list.name] || '').trim();
    const duplicate = existingLists.some(other =>
      other.name !== list.name && other.name.toLowerCase() === nextName.toLowerCase()
    );
    if (!nextName || nextName === list.name || duplicate) return;
    setSaving(`rename:${list.name}`);
    setError('');
    try {
      await renameCustomList(list.name, nextName);
      onRenamed?.(list.name, nextName);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving('');
    }
  }

  async function handleDelete(list) {
    if (confirmDelete !== list.name) {
      setConfirmDelete(list.name);
      return;
    }
    setSaving(`delete:${list.name}`);
    setError('');
    try {
      await clearCustomList(list.name);
      setConfirmDelete('');
      onDeleted?.(list.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving('');
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Manage Lists</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {existingLists.length === 0 && (
            <div style={{ padding: 18, color: 'var(--dim)', fontSize: 12, textAlign: 'center' }}>
              No custom lists yet
            </div>
          )}

          {existingLists.length > 0 && (
            <div className="form-row">
              <label className="form-label">Existing Lists</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {existingLists.map(list => {
                  const nextName = (editNames[list.name] || '').trim();
                  const duplicate = existingLists.some(other =>
                    other.name !== list.name && other.name.toLowerCase() === nextName.toLowerCase()
                  );
                  const renameDisabled = saving || !nextName || nextName === list.name || duplicate;
                  return (
                    <div key={list.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        className="form-input"
                        value={editNames[list.name] || ''}
                        onChange={e => setEditNames(prev => ({ ...prev, [list.name]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(list); }}
                        style={{ flex: '1 1 auto', minWidth: 0 }}
                      />
                      <button
                        className="btn btn-outline"
                        type="button"
                        disabled={renameDisabled}
                        onClick={() => handleRename(list)}
                      >
                        {saving === `rename:${list.name}` ? 'Saving...' : 'Rename'}
                      </button>
                      <button
                        className={confirmDelete === list.name ? 'btn btn-danger' : 'btn btn-danger-outline'}
                        type="button"
                        disabled={Boolean(saving)}
                        onClick={() => handleDelete(list)}
                      >
                        {saving === `delete:${list.name}`
                          ? 'Deleting...'
                          : confirmDelete === list.name
                            ? 'Confirm Delete'
                            : 'Delete'}
                      </button>
                      {duplicate && (
                        <span style={{ color: 'var(--red)', fontSize: 11 }}>
                          Name already exists.
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-outline" type="button" onClick={onClose} disabled={saving}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
