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
  const [error, setError] = useState('');
  const [coverStatus, setCoverStatus] = useState(null);   // { ok, reason } | null

  // Resolve the active tab into a prefilled entry: DOM-scrape NU-style sites,
  // otherwise relay the URL to the backend's /search/from-url.
  const loadEntry = useCallback(async () => {
    setPhase('loading'); setError('');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) { setPhase('unsupported'); return; }

      const site = detectSite(tab.url);
      if (site.kind === 'unsupported') { setPhase('unsupported'); return; }

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

  // Best-effort cover caching for ALL sources. The background service worker
  // does the privileged fetch (CORS-exempt for any host; injects cf_clearance
  // for Cloudflare-gated covers) and returns the bytes base64-encoded; here we
  // rebuild the blob and upload it. Never blocks the add — returns a status so
  // the popup can show why a cover did/didn't cache.
  async function cacheCover(coverUrl) {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'fetchCover', coverUrl });
      if (!resp || !resp.ok) return { ok: false, reason: (resp && resp.reason) || 'fetch failed' };
      const binary = atob(resp.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: resp.contentType || 'image/jpeg' });
      await uploadCover(coverUrl, blob);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message || 'fetch failed' };
    }
  }

  async function handleSubmit(form) {
    const payload = formToPayload(form, { isEdit: false });
    await createEntry(payload);

    let cover = null;
    if (form.cover_url) {
      cover = await cacheCover(form.cover_url);
      if (!cover.ok) console.warn('[LOG] cover not cached:', cover.reason, form.cover_url);
    }
    setCoverStatus(cover);
    setPhase('done');
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
    return (
      <div className="ext-state">
        <div className="ext-state-title ext-ok">✓ Added to your library</div>
        {coverStatus && (coverStatus.ok
          ? <div className="ext-ok" style={{ fontSize: 11 }}>Cover cached ✓</div>
          : <div style={{ fontSize: 11, color: 'var(--dim)' }}>Cover not cached — {coverStatus.reason}</div>)}
        {!coverStatus && <div style={{ fontSize: 11, color: 'var(--dim)' }}>No cover to cache</div>}
        <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => window.close()}>Close</button>
      </div>
    );
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
