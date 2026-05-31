import { useEffect, useState } from 'react';
import { getDuplicateEntries, batchDeleteEntries } from '../../api.jsx';
import { statusLabel, onCoverError } from '../../utils.jsx';
import { SkeletonLine } from './Skeletons.jsx';

/**
 * Duplicate finder: groups entries that share a (title, medium), lets the user
 * pick which one to keep per group and delete the rest. v1 "merge" is
 * keep-one-delete-others — it does not combine fields.
 */
export default function DedupModal({ onClose, onResolved }) {
  const [groups, setGroups] = useState(null);
  const [keep, setKeep] = useState({});       // groupKey -> entry id to keep
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getDuplicateEntries();
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setGroups(list);
        // Default: keep the first entry in each group.
        setKeep(Object.fromEntries(list.map(g => [g.key, g.entries[0]?.id])));
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-header">
          <span className="modal-title">Find Duplicates</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 10 }}>{error}</div>}

          {groups === null && (
            <div style={{ padding: 12 }}>
              <SkeletonLine width="60%" />
              <SkeletonLine width="45%" style={{ marginTop: 8 }} />
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

          {groups !== null && groups.length > 0 && (
            <>
              <p style={{ margin: '0 0 14px', color: 'var(--dim)', fontSize: 12 }}>
                {groups.length} duplicate group{groups.length === 1 ? '' : 's'} found.
                Pick the entry to keep in each group, then delete the rest.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {groups.map(group => (
                  <div key={group.key} className="dedup-group">
                    <div className="dedup-group-head">{group.key}</div>
                    {group.entries.map(entry => (
                      <label key={entry.id} className="dedup-entry">
                        <input
                          type="radio"
                          name={`keep:${group.key}`}
                          checked={keep[group.key] === entry.id}
                          onChange={() => setKeep(k => ({ ...k, [group.key]: entry.id }))}
                        />
                        <div className="cover-thumb dedup-cover">
                          {entry.cover_url && (
                            <img src={entry.cover_url} alt=""
                              referrerPolicy="no-referrer"
                              onError={onCoverError} />
                          )}
                        </div>
                        <div className="dedup-entry-info">
                          <span className="media-name">{entry.title}</span>
                          <span className="dedup-entry-meta">
                            <span className={`badge badge-${entry.status}`}>{statusLabel(entry.status)}</span>
                            {entry.year ? ` · ${entry.year}` : ''}
                            {entry.rating != null ? ` · ★ ${entry.rating}` : ''}
                            {entry.custom_list ? ` · ${entry.custom_list}` : ''}
                          </span>
                        </div>
                      </label>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-outline" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
