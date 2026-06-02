// Website-side helpers for talking to the Logarium browser extension.
//
// The extension injects a content-script bridge (bridge.js) on this origin that
// (a) tags the document so we can detect it, and (b) relays window.postMessage
// requests to its background worker and posts results back. All messages use
// { logarium: true, dir: 'toExt' | 'fromExt', … }.

import { useEffect, useState } from 'react';
import { BASE } from './api.jsx';

// ── Presence ──────────────────────────────────────────────────────────────────

export function extensionPresent() {
  return typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-logarium-ext') === '1';
}

/** React hook: true once the extension's bridge has tagged the page. */
export function useExtensionPresent() {
  const [present, setPresent] = useState(extensionPresent);
  useEffect(() => {
    const check = () => setPresent(extensionPresent());
    check();
    window.addEventListener('logarium-ext-ready', check);
    return () => window.removeEventListener('logarium-ext-ready', check);
  }, []);
  return present;
}

const post = (msg) =>
  window.postMessage({ logarium: true, dir: 'toExt', ...msg }, window.location.origin);

// ── Cover resync (used by ResyncModal) ────────────────────────────────────────

export const startSync = (sources, token, apiBase) => post({ type: 'startSync', sources, token, apiBase });
export const cancelSync = () => post({ type: 'cancelSync' });

// ── NovelUpdates search (silent fallback) ─────────────────────────────────────
// NU keyword search is Cloudflare-blocked server-side, so when the extension is
// present we run it client-side: the background worker fetches the Series Finder
// first-party (with the user's cf_clearance) and returns parsed results.

let _nuReqId = 0;

export function extensionNuSearch(query, timeoutMs = 25000) {
  if (!extensionPresent() || !query?.trim()) return Promise.resolve([]);
  return new Promise((resolve) => {
    const id = ++_nuReqId;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMsg); };
    const timer = setTimeout(() => { cleanup(); resolve([]); }, timeoutMs);
    function onMsg(e) {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.logarium !== true || d.dir !== 'fromExt' || d.type !== 'searchNuResult' || d.id !== id) return;
      cleanup();
      resolve(d.ok && Array.isArray(d.results) ? d.results : []);
    }
    window.addEventListener('message', onMsg);
    // token + apiBase let the extension cache each result's cover server-side
    // (NU covers 403 cross-site, so they only display from our cached copy).
    post({ type: 'searchNu', id, query: query.trim(), token: localStorage.getItem('auth_token'), apiBase: BASE });
  });
}

/** Merge `extra` results into `base`, skipping title|medium duplicates. */
export function mergeResults(base, extra) {
  const key = (r) => `${(r.title || '').toLowerCase().trim()}|${r.medium || ''}`;
  const seen = new Set(base.map(key));
  const out = [...base];
  for (const r of extra) {
    const k = key(r);
    if (!seen.has(k)) { seen.add(k); out.push(r); }
  }
  return out;
}

// ── Install links ─────────────────────────────────────────────────────────────
// Chrome can't be installed from an arbitrary site (Web Store only). Firefox
// installs from a signed .xpi — rather than hardcoding a versioned URL that goes
// stale on every `npm run sign:firefox`, we resolve the newest .xpi committed to
// the repo's dist-artifacts folder via the GitHub contents API at runtime.

export const EXTENSION_CHROME_URL = '';   // e.g. https://chromewebstore.google.com/detail/…

const GH_REPO         = 'LeweiXu/logarium';
const GH_ARTIFACT_DIR = 'extension/dist-artifacts';

// [major, minor, patch] from the dotted version token in a filename, e.g.
// "<hash>-1.2.0.xpi" or "logarium-1.2.0-chrome.zip" → [1, 2, 0]. We match the
// LAST dotted token so a non-dotted digit run (like the AMO hash prefix) isn't
// mistaken for the version. Missing parts default to 0 so unversioned names
// sort last.
function versionInName(name) {
  const tokens = name.match(/\d+\.\d+(?:\.\d+)?/g);
  const parts = (tokens ? tokens[tokens.length - 1] : '').split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

let _assetsPromise = null;
/**
 * Resolve the download URLs of the newest signed Firefox .xpi and Chrome .zip
 * committed under dist-artifacts (highest version in each filename). Cached for
 * the page load. Each field is '' if absent or the API call fails.
 */
export function fetchExtensionAssets() {
  if (_assetsPromise) return _assetsPromise;
  _assetsPromise = (async () => {
    const api = `https://api.github.com/repos/${GH_REPO}/contents/${GH_ARTIFACT_DIR}?ref=main`;
    const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const files = await res.json();
    const list = Array.isArray(files) ? files : [];
    const latest = (ext) => {
      const matches = list.filter(f => f?.name?.toLowerCase().endsWith(ext));
      if (!matches.length) return '';
      matches.sort((a, b) => {
        const va = versionInName(a.name), vb = versionInName(b.name);
        for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
        return b.name.localeCompare(a.name);
      });
      return matches[0].download_url || '';
    };
    return { firefox: latest('.xpi'), chrome: latest('.zip') };
  })().catch(() => ({ firefox: '', chrome: '' }));
  return _assetsPromise;
}

/** Newest Firefox .xpi download URL (or '' on failure). */
export function fetchLatestFirefoxXpiUrl() {
  return fetchExtensionAssets().then(a => a.firefox);
}

export function isFirefox() {
  return typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
}

/**
 * React hook: the best inline install URL for the current browser, or '' until
 * resolved. Firefox resolves the latest repo .xpi; Chrome has no one-click link
 * (the .zip is load-unpacked only), so it falls back to EXTENSION_CHROME_URL.
 */
export function useExtensionInstallUrl() {
  const [url, setUrl] = useState(() => (isFirefox() ? '' : EXTENSION_CHROME_URL));
  useEffect(() => {
    if (!isFirefox()) { setUrl(EXTENSION_CHROME_URL); return; }
    let cancelled = false;
    fetchLatestFirefoxXpiUrl().then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, []);
  return url;
}

/**
 * React hook: { firefox, chrome, loading } download URLs, resolving from the
 * repo. `loading` is true until the API call settles so consumers can tell
 * "still resolving" apart from "resolved but no asset present".
 */
export function useExtensionDownloads() {
  const [state, setState] = useState({ firefox: '', chrome: '', loading: true });
  useEffect(() => {
    let cancelled = false;
    fetchExtensionAssets().then(a => { if (!cancelled) setState({ ...a, loading: false }); });
    return () => { cancelled = true; };
  }, []);
  return state;
}
