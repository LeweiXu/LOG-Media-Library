import { useEffect, useState, useCallback } from 'react';
import AuthModal from '../../../frontend/pages/components/AuthModal.jsx';
import EntryForm, { formToPayload } from '../../../frontend/pages/components/EntryForm.jsx';
import { BASE, fetchByUrl, createEntry, uploadCover } from '../../../frontend/api.jsx';
import { detectSite } from '../lib/site.js';

// When shown as an in-page overlay (?embed=1) we live inside an iframe on the
// host page. Firefox sandboxes that iframe — no chrome.tabs/scripting and no
// cross-origin fetch — so every privileged op is delegated to the background
// worker, and closing means telling the parent to remove the overlay.
const EMBED = new URLSearchParams(window.location.search).get('embed') === '1';
const getToken = () => localStorage.getItem('auth_token');
function closeUi() {
  if (EMBED) window.parent.postMessage({ logariumExtClose: true }, '*');
  else window.close();
}

// Phases: 'auth' (logged out) | 'loading' | 'ready' | 'unsupported' | 'error' | 'done'
export default function App() {
  const [token, setToken] = useState(getToken);
  const [phase, setPhase] = useState(token ? 'loading' : 'auth');
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [coverStatus, setCoverStatus] = useState(null);   // { ok, reason } | null

  // Resolve the source tab into a prefilled entry: DOM-scrape NU-style sites,
  // otherwise relay the URL to the backend's /search/from-url. In overlay mode
  // the sandboxed iframe can't touch chrome.tabs, so the background does it.
  const loadEntry = useCallback(async () => {
    setPhase('loading'); setError('');
    try {
      const tabIdParam = new URLSearchParams(window.location.search).get('tabId');

      if (EMBED) {
        const resp = await chrome.runtime.sendMessage({
          type: 'embedLoadEntry', tabId: tabIdParam, token: getToken(), apiBase: BASE,
        });
        if (!resp || !resp.ok) {
          if (resp && resp.reason === 'unsupported') { setPhase('unsupported'); return; }
          setError("Couldn't read media details from this page."); setPhase('error'); return;
        }
        setEntry(resp.entry); setPhase('ready'); return;
      }

      // Full-privilege contexts (centred window / toolbar popup): do it directly.
      const tab = tabIdParam
        ? await chrome.tabs.get(Number(tabIdParam))
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
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

  useEffect(() => {
    if (!EMBED) return;
    // Let the overlay know we mounted (cancels its CSP-fallback timer).
    window.parent.postMessage({ logariumExtReady: true }, '*');
    // Login can't fetch from the sandboxed iframe — hand sign-in to a window.
    if (!token) {
      try { chrome.runtime.sendMessage({ type: 'overlayFallback' }); } catch { /* ignore */ }
      closeUi();
    }
  }, []);

  function handleAuth(newToken) {
    try { chrome.storage?.local.set({ auth_token: newToken }); } catch { /* ignore */ }
    setToken(newToken);
  }

  // Best-effort cover caching (full-privilege contexts). The background fetches
  // the bytes (injecting cf_clearance for Cloudflare hosts); we upload them.
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

    if (EMBED) {
      const resp = await chrome.runtime.sendMessage({
        type: 'embedCreateEntry', payload, token: getToken(), apiBase: BASE,
      });
      if (!resp || !resp.ok) throw new Error((resp && resp.reason) || 'Failed to add entry');
    } else {
      await createEntry(payload);
    }

    let cover = null;
    if (form.cover_url) {
      if (EMBED) {
        const r = await chrome.runtime.sendMessage({
          type: 'embedCacheCover', coverUrl: form.cover_url, token: getToken(), apiBase: BASE,
        });
        cover = r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || 'fetch failed' };
      } else {
        cover = await cacheCover(form.cover_url);
      }
      if (!cover.ok) console.warn('[LOG] cover not cached:', cover.reason, form.cover_url);
    }
    setCoverStatus(cover);
    setPhase('done');
  }

  if (phase === 'auth') {
    // In overlay mode we redirect sign-in to a window (see the effect above).
    if (EMBED) {
      return <div className="ext-state"><span className="loading-dots">Opening sign-in</span></div>;
    }
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
        <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={closeUi}>Close</button>
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
        onCancel={closeUi}
        submitLabel="Add to Library"
        savingLabel="Adding…"
      />
    </div>
  );
}
