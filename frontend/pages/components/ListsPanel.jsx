import { useCallback, useEffect, useState } from 'react';
import { clearCustomList, getEntries, renameCustomList, updateEntry } from '../../api.jsx';
import { extractItems, statusLabel } from '../../utils.jsx';
import { SkeletonLine } from './Skeletons.jsx';
import { Tabs, SelectRow } from './terminal.jsx';

const PAGE_SIZE = 10;
const MAX_LIST_NAME_LENGTH = 60;

/**
 * Custom-list body shared by the inline Console panel and the Library "+ New"
 * modal. "Add List" (build a new list from library entries) and "Manage Lists"
 * (rename/delete existing) live as two tabs.
 *
 * When `onClose` is provided (modal use) the body shows Cancel/Close buttons and
 * lets the parent dismiss after an action. Without it (inline use) those buttons
 * are hidden and the add form resets in place so you can keep going.
 */
export default function ListsPanel({
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
      // Inline use: reset so the next list can be built without remounting.
      if (!onClose) { setName(''); setSelected({}); }
    } catch (err) {
      setAddError(err.message);
    } finally {
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

  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ key: 'add', label: 'Add List' }, { key: 'manage', label: 'Manage Lists' }]}
      />

      <div className="modal-body">
        {/* ── Add tab ── */}
        {tab === 'add' && (
          <>
            <div className="form-row">
              <label className="form-label">List Name *</label>
              <input
                className="form-input"
                value={name}
                maxLength={MAX_LIST_NAME_LENGTH}
                placeholder="e.g. Next up"
                onChange={e => setName(e.target.value.slice(0, MAX_LIST_NAME_LENGTH))}
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

            <div className="picker-list">
              {loading && (
                <div className="picker-loading">
                  <SkeletonLine width="70%" />
                  <SkeletonLine width="55%" />
                </div>
              )}

              {!loading && entries.length === 0 && (
                <div className="picker-empty">No entries found</div>
              )}

              {!loading && entries.map(entry => (
                <SelectRow key={entry.id} on={Boolean(selected[entry.id])} onClick={() => toggle(entry)}>
                  <span className="sr-title">{entry.title}</span>
                  <span className="sr-meta">
                    {entry.medium || '-'} · {statusLabel(entry.status)}
                    {entry.custom_list ? ` · currently in ${entry.custom_list}` : ''}
                  </span>
                </SelectRow>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="picker-pager">
                <button className="icon-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span className="picker-pager-info">Page {page} of {totalPages}</span>
                <button className="icon-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            )}

            <div className={`picker-count${selectedEntries.length ? '' : ' is-empty'}`}>
              {selectedEntries.length} selected
            </div>

            {overwrites.length > 0 && (
              <div className="settings-msg settings-msg-error">
                {overwrites.length} selected entr{overwrites.length === 1 ? 'y is' : 'ies are'} already in a custom list and will be moved.
              </div>
            )}

            {emptiedLists.length > 0 && (
              <div className="settings-msg settings-msg-error">
                Moving the selected entries will remove {emptiedLists.map(list => `"${list.name}"`).join(', ')} because no entries will remain.
              </div>
            )}

            {nameExists && (
              <div className="settings-msg settings-msg-error">
                A custom list with this name already exists.
              </div>
            )}

            {addError && <div className="modal-error">{addError}</div>}

            <div className="modal-actions">
              {onClose && (
                <button className="btn btn-outline" type="button" onClick={onClose} disabled={creating}>
                  Cancel
                </button>
              )}
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
              <div className="picker-empty">No custom lists yet</div>
            )}

            {existingLists.length > 0 && (
              <div className="form-row">
                <label className="form-label">Existing Lists</label>
                <div className="lists-manage-rows">
                  {existingLists.map(list => {
                    const nextName = (editNames[list.name] || '').trim();
                    const duplicate = existingLists.some(other =>
                      other.name !== list.name && other.name.toLowerCase() === nextName.toLowerCase()
                    );
                    const renameDisabled = saving || !nextName || nextName === list.name || duplicate;
                    return (
                      <div key={list.name} className="lists-manage-row">
                        <input
                          className="form-input"
                          value={editNames[list.name] || ''}
                          maxLength={MAX_LIST_NAME_LENGTH}
                          onChange={e => setEditNames(prev => ({ ...prev, [list.name]: e.target.value.slice(0, MAX_LIST_NAME_LENGTH) }))}
                          onKeyDown={e => { if (e.key === 'Enter') handleRename(list); }}
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
                        {duplicate && <span className="lists-manage-dupe">Name already exists.</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {manageError && <div className="modal-error">{manageError}</div>}

            {onClose && (
              <div className="modal-actions">
                <button className="btn btn-outline" type="button" onClick={onClose} disabled={Boolean(saving)}>
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
