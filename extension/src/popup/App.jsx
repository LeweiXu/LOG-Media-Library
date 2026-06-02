import { useEffect, useState, useCallback, useRef } from 'react';
import AuthModal from '../../../frontend/pages/components/AuthModal.jsx';
import EntryForm, { formToPayload } from '../../../frontend/pages/components/EntryForm.jsx';
import { BASE, fetchByUrl, createEntry, updateEntry, uploadCover, findEntryByUrl } from '../../../frontend/api.jsx';
import { statusLabel } from '../../../frontend/utils.jsx';
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
  const [fetchedEntry, setFetchedEntry] = useState(null);  // scraped/API media data
  const [existing, setExisting] = useState(null);          // matching library entry | null
  const [addingNew, setAddingNew] = useState(false);       // user chose "New Entry" despite a match
  const [error, setError] = useState('');
  const [coverStatus, setCoverStatus] = useState(null);    // { ok, reason } | null
  const [doneLabel, setDoneLabel] = useState('Added to your library');
  const rootRef = useRef(null);

  // When a library match exists and the user hasn't overridden it, we edit that
  // entry; otherwise we add a new one.
  const editing = Boolean(existing) && !addingNew;
  const formEntry = editing ? existing : fetchedEntry;

  // Resolve the source tab into a prefilled entry — but check the library FIRST:
  // if the page's source link already exists we edit it and skip the scrape/API
  // fetch entirely. Only when there's no match do we read the media details.
  const loadEntry = useCallback(async () => {
    setPhase('loading'); setError('');
    setExisting(null); setFetchedEntry(null); setAddingNew(false);
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
        setExisting(resp.existing || null);
        setFetchedEntry(resp.entry || null);
        setPhase('ready');
        return;
      }

      // Full-privilege contexts (centred window / toolbar popup): do it directly.
      const tab = tabIdParam
        ? await chrome.tabs.get(Number(tabIdParam))
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.url) { setPhase('unsupported'); return; }

      // 1) Existence check by the page URL — before any scrape/API fetch.
      const existingByTab = await findEntryByUrl(tab.url).catch(() => null);
      if (existingByTab) { setExisting(existingByTab); setPhase('ready'); return; }

      // 2) Not in the library → resolve the page into a prefilled entry.
      const data = await scrapeOrFetch(tab);
      if (!data || !data.title) {
        setError("Couldn't read media details from this page.");
        setPhase('error');
        return;
      }

      // 3) Second check against the resolved canonical URL (e.g. a chapter page
      //    resolves to the series URL that was actually stored).
      let ex2 = null;
      if (data.external_url && data.external_url !== tab.url) {
        ex2 = await findEntryByUrl(data.external_url).catch(() => null);
      }
      setExisting(ex2);
      setFetchedEntry(data);
      setPhase('ready');
    } catch (e) {
      setError(e.message || 'Failed to read this page.');
      setPhase('error');
    }
  }, []);

  // Scrape (NU-style) or relay to /search/from-url. Non-embed only — the embed
  // path delegates the equivalent work to the background worker.
  async function scrapeOrFetch(tab) {
    const site = detectSite(tab.url);
    if (site.kind === 'unsupported') { const e = new Error('unsupported'); e.code = 'unsupported'; throw e; }
    if (site.kind === 'dom') {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: site.scraper,
      });
      return result;
    }
    const results = await fetchByUrl(tab.url);
    return Array.isArray(results) && results[0] ? { ...results[0], status: 'planned' } : null;
  }

  // "New Entry": fetch the media details (if not already fetched) and switch to
  // add mode, leaving the existing entry untouched.
  async function startNewEntry() {
    if (fetchedEntry) { setAddingNew(true); return; }
    setPhase('loading');
    try {
      const tabIdParam = new URLSearchParams(window.location.search).get('tabId');
      let data;
      if (EMBED) {
        const resp = await chrome.runtime.sendMessage({
          type: 'embedFetchEntry', tabId: tabIdParam, token: getToken(), apiBase: BASE,
        });
        if (!resp || !resp.ok) throw new Error(resp?.reason === 'unsupported'
          ? "This page isn't a supported source — can't auto-fill a new entry."
          : "Couldn't read media details from this page.");
        data = resp.entry;
      } else {
        const tab = tabIdParam
          ? await chrome.tabs.get(Number(tabIdParam))
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        data = await scrapeOrFetch(tab);
        if (!data || !data.title) throw new Error("Couldn't read media details from this page.");
      }
      setFetchedEntry(data);
      setAddingNew(true);
    } catch (e) {
      alert(e.code === 'unsupported'
        ? "This page isn't a supported source — can't auto-fill a new entry."
        : (e.message || 'Failed to read this page.'));
    } finally {
      setPhase('ready');
    }
  }

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

  // Report our content height to the overlay so the iframe fits the form without
  // an inner scrollbar (the host-page overlay can't measure us cross-origin).
  useEffect(() => {
    if (!EMBED || !rootRef.current) return;
    const el = rootRef.current;
    const post = () => {
      try {
        window.parent.postMessage({ logariumExtHeight: Math.ceil(el.getBoundingClientRect().height) }, '*');
      } catch { /* ignore */ }
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function handleAuth(newToken) {
    try { chrome.storage?.local.set({ auth_token: newToken }); } catch { /* ignore */ }
    // Sign-in happens in its own window; close it instead of dropping into the
    // add form. The token is already persisted, so re-opening the extension on
    // the target page picks up straight at the add/edit step.
    closeUi();
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
    const payload = formToPayload(form, { isEdit: editing });

    if (editing) {
      if (EMBED) {
        const resp = await chrome.runtime.sendMessage({
          type: 'embedUpdateEntry', id: existing.id, payload, token: getToken(), apiBase: BASE,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.reason) || 'Failed to update entry');
      } else {
        await updateEntry(existing.id, payload);
      }
    } else {
      if (EMBED) {
        const resp = await chrome.runtime.sendMessage({
          type: 'embedCreateEntry', payload, token: getToken(), apiBase: BASE,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.reason) || 'Failed to add entry');
      } else {
        await createEntry(payload);
      }
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
    setDoneLabel(editing ? 'Updated library entry' : 'Added to your library');
    setPhase('done');
  }

  let content;
  if (phase === 'auth') {
    // In overlay mode we redirect sign-in to a window (see the effect above).
    content = EMBED
      ? <div className="ext-state"><span className="loading-dots">Opening sign-in</span></div>
      : <AuthModal onAuth={handleAuth} />;
  } else if (phase === 'loading') {
    content = <div className="ext-state"><span className="loading-dots">Reading page</span></div>;
  } else if (phase === 'unsupported') {
    content = (
      <div className="ext-state">
        <div className="ext-state-title">Not a supported media page</div>
        <div>Open a NovelUpdates series or a supported source page, then try again.</div>
      </div>
    );
  } else if (phase === 'error') {
    content = (
      <div className="ext-state">
        <div className="ext-state-title">Couldn’t add from this page</div>
        <div>{error}</div>
        <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={loadEntry}>Retry</button>
      </div>
    );
  } else if (phase === 'done') {
    content = (
      <div className="ext-state">
        <div className="ext-state-title ext-ok">✓ {doneLabel}</div>
        {coverStatus && (coverStatus.ok
          ? <div className="ext-ok" style={{ fontSize: 11 }}>Cover cached ✓</div>
          : <div style={{ fontSize: 11, color: 'var(--dim)' }}>Cover not cached — {coverStatus.reason}</div>)}
        {!coverStatus && <div style={{ fontSize: 11, color: 'var(--dim)' }}>No cover to cache</div>}
        <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={closeUi}>Close</button>
      </div>
    );
  } else {
    content = (
      <div className="ext-wrap">
        <div className="ext-header">
          <span className="ext-title">Add to Library</span>
          {formEntry?.source && <span className="ext-source">{formEntry.source}</span>}
        </div>
        {editing && (
          <div className="ext-exists" role="status">
            ✓ Already in your library — editing existing entry
          </div>
        )}
        <EntryForm
          key={editing ? `edit-${existing.id}` : 'new'}
          entry={formEntry}
          onSubmit={handleSubmit}
          onCancel={closeUi}
          submitLabel={editing ? 'Update' : 'Add to Library'}
          savingLabel={editing ? 'Updating…' : 'Adding…'}
          leftAction={editing
            ? <button type="button" className="btn btn-outline" onClick={startNewEntry}>New Entry</button>
            : null}
        />
      </div>
    );
  }

  return <div ref={rootRef}>{content}</div>;
}
