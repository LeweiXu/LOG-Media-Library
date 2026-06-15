import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDuplicateEntries, batchDeleteEntries } from '../../api.jsx';
import { statusLabel, onCoverError } from '../../utils.jsx';
import { SkeletonLine } from './Skeletons.jsx';
import { Box } from './terminal.jsx';
import EntryDetailModal from './EntryDetailModal.jsx';

/**
 * Duplicate finder: groups entries that share a (title, medium), lets the user
 * pick which one to keep per group and delete the rest — either one group at a
 * time, or every group at once via "Delete all". Entries can also be edited in
 * place, since some "duplicates" are really just mis-tagged entries (e.g. a
 * manga logged as anime) that stop colliding once corrected. v1 "merge" is
 * keep-one-delete-others; it does not combine fields.
 */
export default function DedupModal({ onClose, onResolved }) {
  const [groups, setGroups] = useState(null);
  const [keep, setKeep] = useState({});       // groupKey -> entry id to keep
  const [busy, setBusy] = useState('');        // group key currently deleting
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [error, setError] = useState('');
  const [editEntry, setEditEntry] = useState(null);

  const loadGroups = useCallback(async () => {
    try {
      const data = await getDuplicateEntries();
      const list = Array.isArray(data) ? data : [];
      setGroups(list);
      // Default: keep the first entry in each group.
      setKeep(Object.fromEntries(list.map(g => [g.key, g.entries[0]?.id])));
      return list;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // After an edit, the entry may no longer collide — re-scan so resolved groups
  // drop out automatically.
  async function handleEdited() {
    setEditEntry(null);
    setGroups(null);
    await loadGroups();
    onResolved?.();
  }

  // Every entry across all groups that isn't the chosen keeper.
  const allDeleteIds = useMemo(() => {
    if (!groups) return [];
    return groups.flatMap(g => g.entries.filter(e => e.id !== keep[g.key]).map(e => e.id));
  }, [groups, keep]);

  async function resolveGroup(group) {
    const keepId = keep[group.key];
    const deleteIds = group.entries.filter(e => e.id !== keepId).map(e => e.id);
    if (deleteIds.length === 0) return;
    setBusy(group.key);
    setError('');
    try {
      await batchDeleteEntries(deleteIds);
      setGroups(prev => prev.filter(g => g.key !== group.key));
      onResolved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  async function resolveAll() {
    if (allDeleteIds.length === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      await batchDeleteEntries(allDeleteIds);
      setGroups([]);
      setConfirmBulk(false);
      onResolved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const hasGroups = groups !== null && groups.length > 0;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-header">
          <span className="modal-title">Find Duplicates</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="dedup-error">{error}</div>}

          {groups === null && (
            <div className="dedup-loading">
              <SkeletonLine width="60%" />
              <SkeletonLine width="45%" />
            </div>
          )}

          {groups !== null && groups.length === 0 && (
            <div className="state-block">
              <div className="state-title">No duplicates found</div>
              <div className="state-detail">
                Every entry has a unique title + medium combination.
              </div>
            </div>
          )}

          {hasGroups && (
            <>
              <div className="dedup-toolbar">
                <div>
                  <p className="dedup-intro">
                    {groups.length} duplicate group{groups.length === 1 ? '' : 's'} found.
                    Pick the entry to keep in each group, then delete the rest — or
                    edit a mis-tagged entry so it no longer collides.
                  </p>
                  <span className="dedup-keyline"><span className="dedup-keep">[X]</span> keep · <span className="dedup-del">[ ]</span> delete</span>
                </div>
                {confirmBulk ? (
                  <div className="dedup-bulk-confirm">
                    <span>Delete {allDeleteIds.length} entr{allDeleteIds.length === 1 ? 'y' : 'ies'}?</span>
                    <button className="btn btn-danger" type="button" disabled={bulkBusy} onClick={resolveAll}>
                      {bulkBusy ? 'Deleting…' : 'Confirm'}
                    </button>
                    <button className="icon-btn" type="button" disabled={bulkBusy} onClick={() => setConfirmBulk(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-danger" type="button"
                    disabled={allDeleteIds.length === 0}
                    onClick={() => setConfirmBulk(true)}>
                    Delete all {allDeleteIds.length}
                  </button>
                )}
              </div>

              <div className="dedup-groups">
                {groups.map(group => (
                  <div key={group.key} className="dedup-group">
                    <div className="dedup-group-head">{group.key}</div>
                    <div className="dedup-entries term-stack">
                      {group.entries.map(entry => {
                        const isKeep = keep[group.key] === entry.id;
                        return (
                          <div
                            key={entry.id}
                            className={`term-row dedup-row${isKeep ? ' is-on' : ''}`}
                            onClick={() => setKeep(k => ({ ...k, [group.key]: entry.id }))}
                          >
                            <Box on={isKeep} />
                            <span className="dedup-entry">
                              <span className="cover-thumb dedup-cover">
                                {entry.cover_url && (
                                  <img src={entry.cover_url} alt=""
                                    referrerPolicy="no-referrer"
                                    onError={onCoverError} />
                                )}
                              </span>
                              <span className="dedup-entry-info">
                                <span className="media-name">{entry.title}</span>
                                <span className="dedup-entry-meta">
                                  <span className={`badge badge-${entry.status}`}>{statusLabel(entry.status)}</span>
                                  {entry.medium ? ` · ${entry.medium}` : ''}
                                  {entry.year ? ` · ${entry.year}` : ''}
                                  {entry.rating != null ? ` · ★ ${entry.rating}` : ''}
                                  {entry.custom_list ? ` · ${entry.custom_list}` : ''}
                                </span>
                              </span>
                            </span>
                            <button
                              type="button"
                              className="icon-btn dedup-edit"
                              onClick={ev => { ev.stopPropagation(); setEditEntry(entry); }}
                            >
                              Edit
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="dedup-group-actions">
                      <button
                        className="btn btn-danger"
                        type="button"
                        disabled={busy === group.key}
                        onClick={() => resolveGroup(group)}
                      >
                        {busy === group.key
                          ? 'Deleting…'
                          : `Delete other ${group.entries.length - 1}`}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="dedup-footer">
            <button className="btn btn-outline" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>

      {editEntry && (
        <EntryDetailModal
          entry={editEntry}
          initialEditing
          onClose={() => setEditEntry(null)}
          onUpdated={handleEdited}
          onDeleted={handleEdited}
        />
      )}
    </div>
  );
}
