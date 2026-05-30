import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearCustomList, getCustomLists, getEntries, getSettings, renameCustomList, updateEntry } from '../api.jsx';
import { extractItems, fmtDate, progressLabel, statusLabel } from '../utils.jsx';
import CreateCustomListModal from './components/CreateCustomListModal.jsx';
import { SkeletonLine, SkeletonTable } from './components/Skeletons.jsx';

const UNLISTED = '';
const PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100];
const DEFAULT_LIMIT = 40;

function validPageSize(value, fallback = DEFAULT_LIMIT) {
  return PAGE_SIZE_OPTIONS.includes(value) ? value : fallback;
}

export default function Manage() {
  const [lists, setLists] = useState([]);
  const [unlistedCount, setUnlistedCount] = useState(0);
  const [selectedList, setSelectedList] = useState(UNLISTED);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [pendingLists, setPendingLists] = useState({});
  const [pendingModes, setPendingModes] = useState({});
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showCreateList, setShowCreateList] = useState(false);
  const [lastEntryWarning, setLastEntryWarning] = useState(null);
  const [settingsApplied, setSettingsApplied] = useState(false);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [drawer, setDrawer] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const listNames = useMemo(() => lists.map(list => list.name), [lists]);
  const selectedMeta = lists.find(list => list.name === selectedList);
  const isUnlisted = selectedList === UNLISTED;
  const totalPages = Math.ceil(total / limit);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    let nextLists = [];
    try {
      const [listData, unlistedData] = await Promise.all([
        getCustomLists(),
        getEntries({ custom_list_empty: true, limit: 1 }),
      ]);
      nextLists = Array.isArray(listData) ? listData : [];
      setLists(nextLists);
      setUnlistedCount(unlistedData?.total ?? extractItems(unlistedData).length);
    } finally {
      setLoadingLists(false);
    }
    return nextLists;
  }, []);

  const loadEntries = useCallback(async () => {
    if (!settingsApplied) return;
    setLoadingEntries(true);
    setError('');
    try {
      const params = isUnlisted
        ? { custom_list_empty: true, sort: 'title', order: 'asc', limit, offset: (page - 1) * limit }
        : { custom_list: selectedList, sort: 'title', order: 'asc', limit, offset: (page - 1) * limit };
      const data = await getEntries(params);
      const items = extractItems(data);
      setEntries(items);
      setTotal(data?.total ?? items.length);
      setPendingLists(Object.fromEntries(items.map(entry => [entry.id, entry.custom_list || ''])));
      setPendingModes(Object.fromEntries(items.map(entry => [entry.id, entry.custom_list ? 'existing' : 'none'])));
      if (!isUnlisted) setRenameValue(selectedList);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingEntries(false);
    }
  }, [isUnlisted, limit, page, selectedList, settingsApplied]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (!cancelled) setLimit(validPageSize(settings.default_entries_per_page));
      } catch { /* fall back to default page size */ }
      finally { if (!cancelled) setSettingsApplied(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);
  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => { setPage(1); }, [selectedList, limit]);
  useEffect(() => { setConfirmDelete(false); }, [selectedList]);

  function entryListValue(entry) {
    if ((pendingModes[entry.id] || 'none') === 'none') return '';
    return (pendingLists[entry.id] || '').trim();
  }

  function isRemovingLastEntryFromList(entry, nextValue) {
    const currentList = entry.custom_list || '';
    if (!currentList || currentList === nextValue) return false;
    const currentMeta = lists.find(list => list.name === currentList);
    return currentMeta?.count === 1;
  }

  async function saveEntryList(entry, { skipWarning = false } = {}) {
    const mode = pendingModes[entry.id] || 'none';
    const nextValue = mode === 'none' ? '' : (pendingLists[entry.id] || '').trim();
    if (!skipWarning && isRemovingLastEntryFromList(entry, nextValue)) {
      setLastEntryWarning({ entry, nextValue });
      return;
    }
    setSaving(`entry:${entry.id}`);
    setLastEntryWarning(null);
    try {
      await updateEntry(entry.id, { custom_list: nextValue || null });
      const nextLists = await loadLists();
      if (selectedList && !nextLists.some(list => list.name === selectedList)) {
        setSelectedList(UNLISTED);
      } else {
        await loadEntries();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving('');
    }
  }

  async function handleRename() {
    const nextName = renameValue.trim();
    if (!selectedList || !nextName || nextName === selectedList) return;
    setSaving('rename');
    setError('');
    try {
      await renameCustomList(selectedList, nextName);
      setSelectedList(nextName);
      setRenameValue(nextName);
      setPage(1);
      await loadLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving('');
    }
  }

  async function handleDeleteList() {
    if (!selectedList) return;
    setSaving('delete');
    setError('');
    try {
      await clearCustomList(selectedList);
      setSelectedList(UNLISTED);
      setConfirmDelete(false);
      setPage(1);
      await loadLists();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving('');
    }
  }

  function setPendingEntryMode(entry, mode) {
    setPendingModes(prev => ({ ...prev, [entry.id]: mode }));
    setPendingLists(prev => {
      if (mode === 'none') return { ...prev, [entry.id]: '' };
      if (mode === 'existing') return { ...prev, [entry.id]: entry.custom_list || listNames[0] || '' };
      return prev;
    });
  }

  function rowChanged(entry) {
    return entryListValue(entry) !== (entry.custom_list || '');
  }

  function handleRowListChange(entry, value) {
    setPendingModes(prev => ({ ...prev, [entry.id]: value ? 'existing' : 'none' }));
    setPendingLists(prev => ({ ...prev, [entry.id]: value }));
  }

  return (
    <div className="layout-3col" data-drawer={drawer}>
      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer('')} aria-hidden="true" />
      )}

      <div className="sidebar-left">
        <div className="sidebar-section">
          <span className="sidebar-label">Custom Lists</span>
          {lists.map(list => (
            <div
              key={list.name}
              className={`sidebar-item${selectedList === list.name ? ' active' : ''}`}
              onClick={() => { setSelectedList(list.name); setDrawer(''); }}
            >
              {list.name}
              <span className="sidebar-count">{list.count}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-section">
          <div
            className={`sidebar-item${isUnlisted ? ' active' : ''}`}
            onClick={() => { setSelectedList(UNLISTED); setDrawer(''); }}
          >
            Unlisted
            {loadingLists
              ? <SkeletonLine width={24} height={14} />
              : <span className="sidebar-count">{unlistedCount}</span>}
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="page-head">
          <div className="page-head-left">
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'left' ? '' : 'left')}
              aria-label="Toggle custom lists"
              title="Custom lists"
            >☰ Lists</button>
            <span className="page-title">Manage</span>
            <span className="page-desc">
              {loadingEntries ? <SkeletonLine width={74} height={11} /> : `${total} entries`}
            </span>
          </div>
          <div className="page-head-mobile">
            <button className="btn" onClick={() => setShowCreateList(true)}>+ New List</button>
            <button
              type="button"
              className="drawer-toggle"
              onClick={() => setDrawer(d => d === 'right' ? '' : 'right')}
              aria-label="Toggle tools"
              title="Tools"
            >⋯</button>
          </div>
        </div>

        <div className="filter-bar">
          <strong style={{ fontSize: 13 }}>
            {isUnlisted ? 'Unlisted Entries' : selectedList}
          </strong>
          <select value={limit} onChange={e => setLimit(Number(e.target.value))}
            style={{ marginLeft: 'auto' }}>
            {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button className="icon-btn" onClick={() => { loadLists(); loadEntries(); }} title="Refresh" style={{ padding: '5px 10px' }}>
            Refresh
          </button>
        </div>

        {!isUnlisted && (
          <div className="filter-bar">
            <input
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); }}
              placeholder="List name"
              style={{ minWidth: 220 }}
            />
            <button
              className="btn"
              disabled={saving === 'rename' || !renameValue.trim() || renameValue.trim() === selectedList}
              onClick={handleRename}
            >
              {saving === 'rename' ? 'Saving...' : 'Rename'}
            </button>
            {!confirmDelete ? (
              <button className="btn btn-danger-outline" onClick={() => setConfirmDelete(true)}>
                Delete List
              </button>
            ) : (
              <>
                <span style={{ fontSize: 11, color: 'var(--red)' }}>
                  Clear {selectedMeta?.count ?? total} entries?
                </span>
                <button className="btn btn-danger" disabled={saving === 'delete'} onClick={handleDeleteList}>
                  {saving === 'delete' ? 'Clearing...' : 'Yes, clear'}
                </button>
                <button className="btn btn-outline" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="state-block">
            <div className="state-title">Error</div>
            <div className="state-detail">{error}</div>
          </div>
        )}

        {!error && loadingEntries && (
          <div className="skeleton-page" aria-label="Loading entries">
            <SkeletonTable
              headers={['Title', 'Status', 'Progress', 'Updated', 'Custom List', 'Actions']}
              rows={12}
              cover
              widths={['78%', '56%', '72%', '58%', '80%', '76%']}
            />
          </div>
        )}

        {!error && !loadingEntries && entries.length === 0 && (
          <div className="state-block">
            <div className="state-title">No entries here</div>
            <div className="state-detail">
              Assign entries to a custom list from an entry form or move entries from another list.
            </div>
          </div>
        )}

        {!error && !loadingEntries && entries.length > 0 && (
          <div>
            <table className="media-table" data-mobile-show="status">
              <thead>
                <tr>
                  <th>Title</th>
                  <th className="col-status">Status</th>
                  <th className="col-progress">Progress</th>
                  <th className="col-updated">Updated</th>
                  <th className="col-medium">Custom List</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(entry => {
                  const mode = pendingModes[entry.id] || 'none';
                  const pendingValue = pendingLists[entry.id] ?? '';
                  const changed = rowChanged(entry);
                  const saveDisabled = !changed || saving === `entry:${entry.id}` || (mode !== 'none' && !pendingValue.trim());
                  return (
                    <tr key={entry.id}>
                      <td>
                        <div className="cover-cell">
                          <div className="cover-thumb">
                            {entry.cover_url && (
                              <img src={entry.cover_url} alt=""
                                onError={ev => { ev.target.style.display = 'none'; }} />
                            )}
                          </div>
                          <span className="media-name">{entry.title}</span>
                        </div>
                      </td>
                      <td className="col-status">
                        <span className={`badge badge-${entry.status}`}>{statusLabel(entry.status)}</span>
                      </td>
                      <td className="col-progress">
                        <span style={{ color: 'var(--dim)' }}>{progressLabel(entry)}</span>
                      </td>
                      <td className="col-updated">
                        <span style={{ color: 'var(--dim)' }}>{fmtDate(entry.updated_at)}</span>
                      </td>
                      <td className="col-medium">
                        <select
                          className="inline-select"
                          value={mode === 'none' ? '' : pendingValue}
                          onChange={ev => handleRowListChange(entry, ev.target.value)}
                          style={{ minWidth: 180 }}
                        >
                          <option value="">No List</option>
                          {listNames.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                      </td>
                      <td>
                        <div className="action-cell-inner">
                          <button
                            className="btn"
                            disabled={saveDisabled}
                            onClick={() => saveEntryList(entry)}
                            style={{ padding: '2px 8px', fontSize: 11 }}
                          >
                            {saving === `entry:${entry.id}` ? 'saving' : 'save'}
                          </button>
                          {entry.custom_list && (
                            <button
                              className="icon-btn"
                              onClick={() => setPendingEntryMode(entry, 'none')}
                              style={{ padding: '2px 8px', fontSize: 11 }}
                            >
                              clear
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', paddingBottom: 16 }}>
                {page > 1 && <button className="icon-btn" onClick={() => setPage(1)}>« First</button>}
                <button className="icon-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>Page {page} of {totalPages}</span>
                <button className="icon-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
                {page < totalPages && <button className="icon-btn" onClick={() => setPage(totalPages)}>Last »</button>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-right">
        <p className="panel-title">Current View</p>
        <div className="stat-box" style={{ marginBottom: 8 }}>
          <span className="stat-val">
            {loadingEntries ? <SkeletonLine width={44} height={22} /> : total}
          </span>
          <span className="stat-lbl">Entries</span>
        </div>
        <p style={{ color: 'var(--dim)', fontSize: 11, lineHeight: 1.5 }}>
          Custom lists are optional. Clearing or deleting a list only removes the list assignment; entries stay in your library.
        </p>
      </div>

      {showCreateList && (
        <CreateCustomListModal
          onClose={() => setShowCreateList(false)}
          existingLists={lists}
          onCreated={(name) => {
            setShowCreateList(false);
            setSelectedList(name);
            setPage(1);
            loadLists();
          }}
        />
      )}

      {lastEntryWarning && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setLastEntryWarning(null)}>
          <div className="modal confirm-modal">
            <div className="modal-header">
              <span className="modal-title">Custom List Will Be Removed</span>
              <button className="icon-btn" onClick={() => setLastEntryWarning(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ margin: '0 0 16px', color: 'var(--dim)', fontSize: 13 }}>
                "{lastEntryWarning.entry.custom_list}" only contains this entry. Saving will remove the entry from that list, so the custom list will disappear.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="btn btn-outline" type="button" onClick={() => setLastEntryWarning(null)}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => saveEntryList(lastEntryWarning.entry, { skipWarning: true })}
                >
                  Save Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
