import { useState, useEffect, useRef } from 'react';
import {
  changePassword, deleteAllEntries, getSettings, updateSettings,
  getBackupStatus, runBackup,
} from '../../api.jsx';
import { MEDIUMS } from '../../utils.jsx';
import CustomSelect from './CustomSelect.jsx';

// Must match the options surfaced on the Library page.
const LIBRARY_SORT_FIELDS = [
  { key: 'title',        label: 'Title' },
  { key: 'medium',       label: 'Medium' },
  { key: 'rating',       label: 'Rating' },
  { key: 'status',       label: 'Status' },
  { key: 'year',         label: 'Year' },
  { key: 'updated_at',   label: 'Updated' },
  { key: 'completed_at', label: 'Completed' },
];
const LIBRARY_PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100];

const EXPLORE_BY_OPTIONS = [
  { key: 'all',    label: 'All' },
  { key: 'genre',  label: 'Genre' },
  { key: 'medium', label: 'Medium' },
  { key: 'origin', label: 'Origin' },
];

export default function SettingsModal({
  onClose, onDataDeleted, onSettingsChanged,
  theme, onThemeChange, onLogout,
}) {
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut,    setLoggingOut]    = useState(false);

  function handleLogoutClick() {
    setLoggingOut(true);
    try { onLogout?.(); } finally { setLoggingOut(false); }
  }

  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState(false);

  // ── Periodic email backup ────────────────────────────────────────────
  // Backup frequency is persisted via /auth/me/settings; the rest of the
  // state (configured, last_backup_at, account email) comes from
  // /backup/status which also reflects the server-side SMTP gate.
  const [backupFreq,    setBackupFreq]    = useState('never');
  const [backupEmail,   setBackupEmail]   = useState('');
  const [lastBackupAt,  setLastBackupAt]  = useState(null);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupError,   setBackupError]   = useState('');
  const [backupNotice,  setBackupNotice]  = useState('');

  // ── Live-bound user settings (Library + Explore) ──────────────────────
  const [exploreMedium,  setExploreMedium]  = useState('');
  const [exploreBy,      setExploreBy]      = useState('');
  const [librarySort,    setLibrarySort]    = useState('');
  const [libraryPerPage, setLibraryPerPage] = useState('');
  const [prefsLoaded,    setPrefsLoaded]    = useState(false);
  const prefsReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        setExploreMedium(s.explore_default_medium || '');
        setExploreBy(s.explore_by || 'all');
        setLibrarySort(s.default_sort || 'updated_at');
        setLibraryPerPage(s.default_entries_per_page || 40);
        setBackupFreq(s.backup_freq || 'never');
      } catch { /* ignore */ }
      finally { if (!cancelled) setPrefsLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pull last_backup_at + the destination email so the UI can show them.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await getBackupStatus();
        if (cancelled) return;
        setBackupEmail(b.email || '');
        setLastBackupAt(b.last_backup_at || null);
      } catch { /* ignore — UI degrades gracefully */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced save when any pref changes.
  useEffect(() => {
    if (!prefsLoaded) return;
    if (!prefsReadyRef.current) {
      prefsReadyRef.current = true;
      return;
    }
    const id = setTimeout(() => {
      updateSettings({
        explore_default_medium:   exploreMedium || null,
        explore_by:               exploreBy,
        default_sort:             librarySort,
        default_entries_per_page: libraryPerPage,
        backup_freq:              backupFreq,
      })
        .then(saved => onSettingsChanged?.(saved))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [
    exploreMedium, exploreBy,
    librarySort, libraryPerPage,
    backupFreq,
    prefsLoaded, onSettingsChanged,
  ]);

  const [screen, setScreen] = useState('settings'); // 'settings' | 'confirm-delete'
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function handleChangePassword(e) {
    e.preventDefault();
    setError(''); setSuccess(false);
    if (newPw !== confirmPw) { setError('New passwords do not match.'); return; }
    setSaving(true);
    try {
      await changePassword(currentPw, newPw);
      setSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRunBackup() {
    setBackupError('');
    setBackupNotice('');
    setBackupRunning(true);
    try {
      const b = await runBackup();
      setLastBackupAt(b.last_backup_at || null);
      setBackupNotice(`Backup sent to ${b.email}.`);
    } catch (err) {
      setBackupError(err.message || String(err));
    } finally {
      setBackupRunning(false);
    }
  }

  async function handleDeleteAll() {
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAllEntries();
      onDataDeleted?.();
      onClose();
    } catch (err) {
      setDeleteError(err.message);
      setDeleting(false);
    }
  }

  if (screen === 'confirm-delete') {
    return (
      <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="modal settings-modal">
          <div className="modal-header">
            <span className="modal-title">Delete All Data</span>
            <button className="icon-btn" onClick={onClose}>✕</button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ textAlign: 'center', fontSize: 36 }}>⚠️</div>
            <p style={{ margin: 0, fontWeight: 600, textAlign: 'center' }}>
              This will permanently delete all your library entries.
            </p>
            <p style={{ margin: 0, color: 'var(--dim)', textAlign: 'center', fontSize: 13 }}>
              This action cannot be undone. Your account will remain active, but every entry in your library will be gone forever.
            </p>
            {deleteError && <div className="settings-msg settings-msg-error">{deleteError}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
              <button className="btn" onClick={() => setScreen('settings')} disabled={deleting}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteAll}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Yes, delete everything'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal settings-modal">
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <p className="settings-section-label">Display</p>
          <div className="form-row" style={{ marginBottom: 14 }}>
            <label className="form-label">Theme</label>
            <CustomSelect
              value={theme || 'dark'}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              onChange={value => onThemeChange?.(value)}
              ariaLabel="Theme"
            />
          </div>

          <div className="settings-divider" />

          <p className="settings-section-label">Authentication</p>
          <form onSubmit={handleChangePassword}>
            <div className="form-row">
              <label className="form-label">Current password</label>
              <input className="form-input" type="password" autoComplete="current-password"
                value={currentPw} onChange={e => setCurrentPw(e.target.value)} required />
            </div>
            <div className="form-row-2">
              <div className="form-row">
                <label className="form-label">New password</label>
                <input className="form-input" type="password" autoComplete="new-password"
                  value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={6} />
              </div>
              <div className="form-row">
                <label className="form-label">Confirm new password</label>
                <input className="form-input" type="password" autoComplete="new-password"
                  value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required minLength={6} />
              </div>
            </div>
            {error   && <div className="settings-msg settings-msg-error">{error}</div>}
            {success && <div className="settings-msg settings-msg-success">Password changed.</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Update Password'}
              </button>
            </div>
          </form>

          <div className="settings-mobile-logout">
            <div className="settings-divider" />
            <div className="settings-auth-action">
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>Log out</div>
                <div style={{ fontSize: 11, color: 'var(--dim)' }}>End your current session on this device.</div>
              </div>
              {confirmLogout ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 11, color: 'var(--red)' }}>sure?</span>
                  <button
                    type="button"
                    className="btn btn-danger-outline"
                    style={{ padding: '6px 10px' }}
                    onClick={handleLogoutClick}
                    disabled={loggingOut}
                  >
                    {loggingOut ? '…' : 'Yes, log out'}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ padding: '6px 10px' }}
                    onClick={() => setConfirmLogout(false)}
                    disabled={loggingOut}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger-outline"
                  onClick={() => setConfirmLogout(true)}
                >
                  Log out
                </button>
              )}
            </div>
          </div>

          <div className="settings-divider" />

          <p className="settings-section-label">Library</p>
          <div className="form-row-2">
            <div>
              <label className="form-label">Default sort</label>
              <CustomSelect
                value={librarySort}
                options={LIBRARY_SORT_FIELDS.map(field => ({
                  value: field.key,
                  label: field.label,
                }))}
                onChange={setLibrarySort}
                disabled={!prefsLoaded}
                placeholder="Loading…"
                ariaLabel="Default sort"
              />
            </div>
            <div>
              <label className="form-label">Entries per page</label>
              <CustomSelect
                value={libraryPerPage}
                options={LIBRARY_PAGE_SIZE_OPTIONS.map(size => ({
                  value: size,
                  label: String(size),
                }))}
                onChange={value => setLibraryPerPage(Number(value))}
                disabled={!prefsLoaded}
                placeholder="Loading…"
                ariaLabel="Entries per page"
              />
            </div>
          </div>

          <div className="settings-divider" />

          <p className="settings-section-label">Explore</p>
          <div className="form-row-2">
            <div>
              <label className="form-label">Default medium</label>
              <CustomSelect
                value={prefsLoaded ? exploreMedium : ''}
                options={[
                  { value: '', label: 'All' },
                  ...MEDIUMS.map(medium => ({ value: medium, label: medium })),
                ]}
                onChange={setExploreMedium}
                disabled={!prefsLoaded}
                placeholder="Loading…"
                maxVisible={MEDIUMS.length + 1}
                ariaLabel="Default medium"
              />
            </div>
            <div>
              <label className="form-label">Explore by</label>
              <CustomSelect
                value={exploreBy}
                options={EXPLORE_BY_OPTIONS.map(option => ({
                  value: option.key,
                  label: option.label,
                }))}
                onChange={setExploreBy}
                disabled={!prefsLoaded}
                placeholder="Loading…"
                ariaLabel="Explore by"
              />
            </div>
          </div>

          <div className="settings-divider" />

          <p className="settings-section-label">Periodic Backup</p>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            A CSV copy of your library will be emailed to{' '}
            <span style={{ color: 'var(--fg)' }}>{backupEmail || 'leweixu@gmail.com'}</span>
            {' '}on the frequency below.
          </div>
          <div className="form-row-2">
            <div>
              <label className="form-label">Backup frequency</label>
              <CustomSelect
                value={backupFreq}
                options={[
                  { value: 'never', label: 'Never' },
                  { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
                onChange={setBackupFreq}
                disabled={!prefsLoaded}
                ariaLabel="Backup frequency"
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn"
                onClick={handleRunBackup}
                disabled={backupRunning}
              >
                {backupRunning ? 'Sending…' : 'Back up now'}
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6 }}>
            {lastBackupAt
              ? `Last backup: ${new Date(lastBackupAt).toLocaleString()}`
              : 'No backup has been sent yet.'}
          </div>
          {backupError  && <div className="settings-msg settings-msg-error">{backupError}</div>}
          {backupNotice && <div className="settings-msg settings-msg-success">{backupNotice}</div>}

          <div className="settings-divider" />

          <p className="settings-section-label" style={{ color: 'var(--danger, #e55)' }}>Danger Zone</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>Delete all data</div>
              <div style={{ fontSize: 11, color: 'var(--dim)' }}>Permanently remove every entry in your library.</div>
            </div>
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => setScreen('confirm-delete')}
            >
              Wipe Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
