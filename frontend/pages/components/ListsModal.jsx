import { useCallback, useEffect, useState } from 'react';
import { clearCustomList, getEntries, renameCustomList, updateEntry } from '../../api.jsx';
import { extractItems, statusLabel } from '../../utils.jsx';
import { SkeletonLine } from './Skeletons.jsx';

const PAGE_SIZE = 10;

/**
 * Combined custom-list modal: "Add List" (build a new list from library entries)
 * and "Manage Lists" (rename/delete existing lists) as two tabs. Defaults to Add.
 */
export default function ListsModal({
  onClose,
  existingLists = [],
  onCreated,
  onRenamed,
  onDeleted,
  initialTab = 'add',
}) {
  const [tab, setTab] = useState(initialTab);

  // ── Add-tab state ──────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [addError, setAddError] = useState('');

  // ── Manage-tab state ───────────────────────────────────────────────────────
  const [editNames, setEditNames] = useState({});
  const [confirmDelete, setConfirmDelete] = useState('');
  const [saving, setSaving] = useState('');
  const [manageError, setManageError] = useState('');

  const selectedEntries = Object.values(selected);
  const trimmedName = name.trim();
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const nameExists = existingLists.some(list => list.name.toLowerCase() === trimmedName.toLowerCase());
  const overwrites = selectedEntries.filter(entry => entry.custom_list && entry.custom_list !== trimmedName);
  const selectedByList = overwrites.reduce((acc, entry) => {
    acc[entry.custom_list] = (acc[entry.custom_list] || 0) + 1;
    return acc;
  }, {});
  const emptiedLists = existingLists.filter(list => selectedByList[list.name] >= list.count);

  const load = useCallback(async () => {
    setLoading(true);
    setAddError('');
    try {
      const data = await getEntries({
        ...(query.trim() && { title: query.trim() }),
        sort: 'title',
        order: 'asc',
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      const items = extractItems(data);
      setEntries(items);
      setTotal(data?.total ?? items.length);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [query]);
  useEffect(() => {
    setEditNames(Object.fromEntries(existingLists.map(list => [list.name, list.name])));
  }, [existingLists]);

  function toggle(entry) {
    setSelected(prev => {
      const next = { ...prev };
      if (next[entry.id]) delete next[entry.id];
      else next[entry.id] = entry;
      return next;
    });
  }

  async function handleCreate() {
    if (!trimmedName || nameExists || selectedEntries.length === 0) return;
    setCreating(true);
    setAddError('');
    try {
      for (const entry of selectedEntries) {
        await updateEntry(entry.id, { custom_list: trimmedName });
      }
      onCreated?.(trimmedName);
    } catch (err) {
      setAddError(err.message);
      setCreating(false);
    }
  }

  async function handleRename(list) {
    const nextName = (editNames[list.name] || '').trim();
    const duplicate = existingLists.some(other =>
      other.name !== list.name && other.name.toLowerCase() === nextName.toLowerCase()
    );
    if (!nextName || nextName === list.name || duplicate) return;
    setSaving(`rename:${list.name}`);
    setManageError('');
    try {
      await renameCustomList(list.name, nextName);
      onRenamed?.(list.name, nextName);
    } catch (err) {
      setManageError(err.message);
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
    setManageError('');
    try {
      await clearCustomList(list.name);
      setConfirmDelete('');
      onDeleted?.(list.name);
    } catch (err) {
      setManageError(err.message);
    } finally {
      setSaving('');
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

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Custom Lists</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <button style={tabStyle('add')} onClick={() => setTab('add')}>Add List</button>
          <button style={tabStyle('manage')} onClick={() => setTab('manage')}>Manage Lists</button>
        </div>

        <div className="modal-body">
          {/* ── Add tab ── */}
          {tab === 'add' && (
            <>
              <div className="form-row">
                <label className="form-label">List Name *</label>
                <input
                  className="form-input"
                  value={name}
                  placeholder="e.g. Next up"
                  onChange={e => setName(e.target.value)}
                  onBlur={e => setName(e.target.value.trim())}
                  autoFocus
                />
              </div>

              <div className="form-row">
                <label className="form-label">Search Library *</label>
                <input
                  className="form-input"
                  value={query}
                  placeholder="Search titles..."
                  onChange={e => setQuery(e.target.value)}
                />
              </div>

              <div style={{ border: '1px solid var(--border)', maxHeight: 300, overflow: 'auto', marginBottom: 10 }}>
                {loading && (
                  <div style={{ padding: 12 }}>
                    <SkeletonLine width="70%" />
                    <SkeletonLine width="55%" style={{ marginTop: 8 }} />
                  </div>
                )}

                {!loading && entries.length === 0 && (
                  <div style={{ padding: 18, color: 'var(--dim)', fontSize: 12, textAlign: 'center' }}>
                    No entries found
                  </div>
                )}

                {!loading && entries.map(entry => {
                  const isSelected = Boolean(selected[entry.id]);
                  return (
                    <div
                      key={entry.id}
                      className="search-result-item"
                      style={{
                        boxShadow: isSelected ? 'inset 0 0 0 2px var(--accent)' : undefined,
                        borderBottom: '1px solid var(--border)',
                      }}
                      onClick={() => toggle(entry)}
                    >
                      <div style={{ flex: 1 }}>
                        <div className="sr-title">{entry.title}</div>
                        <div className="sr-meta">
                          {entry.medium || '-'} · {statusLabel(entry.status)}
                          {entry.custom_list ? ` · currently in ${entry.custom_list}` : ''}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 10 }}>
                  <button className="icon-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                  <span style={{ color: 'var(--dim)', fontSize: 11 }}>Page {page} of {totalPages}</span>
                  <button className="icon-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                </div>
              )}

              <div style={{ color: selectedEntries.length ? 'var(--dim)' : 'var(--red)', fontSize: 11, marginBottom: 8 }}>
                {selectedEntries.length} selected
              </div>

              {overwrites.length > 0 && (
                <div className="settings-msg settings-msg-error" style={{ marginBottom: 8 }}>
                  {overwrites.length} selected entr{overwrites.length === 1 ? 'y is' : 'ies are'} already in a custom list and will be moved.
                </div>
              )}

              {emptiedLists.length > 0 && (
                <div className="settings-msg settings-msg-error" style={{ marginBottom: 8 }}>
                  Moving the selected entries will remove {emptiedLists.map(list => `"${list.name}"`).join(', ')} because no entries will remain.
                </div>
              )}

              {nameExists && (
                <div className="settings-msg settings-msg-error" style={{ marginBottom: 8 }}>
                  A custom list with this name already exists.
                </div>
              )}

              {addError && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{addError}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-outline" type="button" onClick={onClose} disabled={creating}>
                  Cancel
                </button>
                <button className="btn" type="button"
                  disabled={creating || !trimmedName || nameExists || selectedEntries.length === 0}
                  onClick={handleCreate}>
                  {creating ? 'Adding...' : 'Add List'}
                </button>
              </div>
            </>
          )}

          {/* ── Manage tab ── */}
          {tab === 'manage' && (
            <>
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

              {manageError && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 8 }}>{manageError}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-outline" type="button" onClick={onClose} disabled={Boolean(saving)}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
