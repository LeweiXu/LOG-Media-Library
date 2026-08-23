import { useState, useEffect, useCallback } from 'react';
import {
  getShareLink, enableShareLink, regenerateShareLink, disableShareLink,
} from '../../api.jsx';

// ── SharePanel ────────────────────────────────────────────────────────────────
// One share link per account. Anyone with it can browse this library read-only
// (see backend/services/share_service.py). Regenerating issues a new link, which
// is what revokes the old one; turning sharing off kills the link outright.

function linkFor(token) {
  return token ? `${window.location.origin}/s/${token}` : '';
}

export default function SharePanel() {
  const [state, setState] = useState({ enabled: false, token: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await getShareLink());
      setError('');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function run(action, fn) {
    setBusy(action);
    setError('');
    try {
      setState(await fn());
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy('');
      setConfirmRegen(false);
    }
  }

  const url = linkFor(state.token);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Could not copy to the clipboard. Select the link and copy it manually.');
    }
  }

  if (loading) return <p className="console-tool-note">Loading…</p>;

  return (
    <div className="share-panel">
      <p className="tool-intro">
        Anyone with this link can browse your library, statistics and rating definitions.
        They cannot add, edit or delete anything, and they never see your email or settings.
        Only one link is valid at a time.
      </p>

      {state.enabled ? (
        <>
          <div className="share-link-row">
            <input className="form-input share-link-input" value={url} readOnly
              onFocus={ev => ev.target.select()} aria-label="Your share link" />
            <button type="button" className="btn" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="share-panel-actions">
            {confirmRegen ? (
              <>
                <span className="confirm-inline-text">
                  the current link stops working. sure?
                </span>
                <button type="button" className="btn btn-danger" disabled={busy === 'regen'}
                  onClick={() => run('regen', regenerateShareLink)}>
                  {busy === 'regen' ? '…' : 'Yes, regenerate'}
                </button>
                <button type="button" className="btn btn-outline"
                  onClick={() => setConfirmRegen(false)}>Cancel</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-outline"
                  onClick={() => setConfirmRegen(true)}>Regenerate link</button>
                <button type="button" className="btn btn-danger-outline" disabled={busy === 'off'}
                  onClick={() => run('off', disableShareLink)}>
                  {busy === 'off' ? '…' : 'Turn sharing off'}
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="share-panel-actions">
          <button type="button" className="btn" disabled={busy === 'on'}
            onClick={() => run('on', enableShareLink)}>
            {busy === 'on' ? '…' : 'Create share link'}
          </button>
          <span className="console-tool-note">Sharing is off — no link works right now.</span>
        </div>
      )}

      {error && <div className="settings-msg settings-msg-error">{error}</div>}
    </div>
  );
}
