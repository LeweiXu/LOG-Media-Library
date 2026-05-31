import { useEffect, useState, useCallback } from 'react';
import AuthModal from '../../../frontend/pages/components/AuthModal.jsx';
import EntryForm, { formToPayload } from '../../../frontend/pages/components/EntryForm.jsx';
import { fetchByUrl, createEntry, uploadCover } from '../../../frontend/api.jsx';
import { detectSite } from '../lib/site.js';

// Phases: 'auth' (logged out) | 'loading' | 'ready' | 'unsupported' | 'error' | 'done'
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('auth_token'));
  const [phase, setPhase] = useState(token ? 'loading' : 'auth');
  const [entry, setEntry] = useState(null);
  const [siteKind, setSiteKind] = useState('');     // 'dom' | 'api'
  const [error, setError] = useState('');

  // Resolve the active tab into a prefilled entry: DOM-scrape NU-style sites,
  // otherwise relay the URL to the backend's /search/from-url.
  const loadEntry = useCallback(async () => {
    setPhase('loading'); setError('');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) { setPhase('unsupported'); return; }

      const site = detectSite(tab.url);
      if (site.kind === 'unsupported') { setPhase('unsupported'); return; }
      setSiteKind(site.kind);

      let data = null;
      if (site.kind === 'dom') {
        const [{ result } = {}] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: site.scraper,
        });
        data = result;
      } else {
        const results = await fetchByUrl(tab.url);
        data = Array.isArray(results) && results[0] ? { ...results[0], status: 'planned' } : null;
      }

      if (!data || !data.title) {
        setError("Couldn't read media details from this page.");
        setPhase('error');
        return;
      }
      setEntry(data);
      setPhase('ready');
    } catch (e) {
      setError(e.message || 'Failed to read this page.');
      setPhase('error');
    }
  }, []);

  useEffect(() => { if (token) loadEntry(); }, [token, loadEntry]);

  function handleAuth(newToken) {
    // AuthModal already wrote auth_token/auth_username to localStorage; mirror the
    // token into chrome.storage so a future background context can use it too.
    try { chrome.storage?.local.set({ auth_token: newToken }); } catch { /* ignore */ }
    setToken(newToken);
  }

  // Best-effort: fetch the cover first-party (extension host permission → cookies
  // sent, CORS-exempt) and upload the bytes to the server cache. Never blocks the
  // add — a failed cover cache just means the cover falls back to a placeholder.
  async function cacheCover(coverUrl) {
    try {
      const res = await fetch(coverUrl, { credentials: 'include' });
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) return;
      await uploadCover(coverUrl, blob);
    } catch { /* best-effort */ }
  }

  async function handleSubmit(form) {
    const payload = formToPayload(form, { isEdit: false });
    await createEntry(payload);
    if (siteKind === 'dom' && form.cover_url) await cacheCover(form.cover_url);
    setPhase('done');
    setTimeout(() => window.close(), 1100);
  }

  if (phase === 'auth') {
    return <AuthModal onAuth={handleAuth} />;
  }

  if (phase === 'loading') {
    return <div className="ext-state"><span className="loading-dots">Reading page</span></div>;
  }

  if (phase === 'unsupported') {
    return (
      <div className="ext-state">
        <div className="ext-state-title">Not a supported media page</div>
        <div>Open a NovelUpdates series or a supported source page, then try again.</div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="ext-state">
        <div className="ext-state-title">Couldn’t add from this page</div>
        <div>{error}</div>
        <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={loadEntry}>Retry</button>
      </div>
    );
  }

  if (phase === 'done') {
    return <div className="ext-state"><div className="ext-state-title ext-ok">✓ Added to your library</div></div>;
  }

  return (
    <div className="ext-wrap">
      <div className="ext-header">
        <span className="ext-title">Add to Library</span>
        {entry?.source && <span className="ext-source">{entry.source}</span>}
      </div>
      <EntryForm
        entry={entry}
        onSubmit={handleSubmit}
        onCancel={() => window.close()}
        submitLabel="Add to Library"
        savingLabel="Adding…"
      />
    </div>
  );
}
