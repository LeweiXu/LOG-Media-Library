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

/** Installed extension version (e.g. "1.2.0"), or '' if absent/unknown. */
export function extensionVersion() {
  return (typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-logarium-ext-version')) || '';
}

// Compare dotted versions; returns >0 if a is newer than b, 0 if equal, <0 else.
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
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

const EMPTY_ASSETS = { firefox: '', chrome: '', firefoxVersion: '', chromeVersion: '', version: '' };

let _assetsPromise = null;
/**
 * Resolve the newest signed Firefox .xpi and Chrome .zip committed under
 * dist-artifacts (highest version in each filename), with their versions and the
 * overall latest version. Cached for the page load; empty fields if absent or
 * the API call fails.
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
      if (!matches.length) return { url: '', version: '' };
      matches.sort((a, b) => {
        const va = versionInName(a.name), vb = versionInName(b.name);
        for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
        return b.name.localeCompare(a.name);
      });
      const top = matches[0];
      const v = versionInName(top.name);
      return { url: top.download_url || '', version: (v[0] || v[1] || v[2]) ? v.join('.') : '' };
    };
    const ff = latest('.xpi'), ch = latest('.zip');
    const version = compareVersions(ff.version || '0', ch.version || '0') >= 0
      ? ff.version : ch.version;
    return {
      firefox: ff.url, firefoxVersion: ff.version,
      chrome: ch.url, chromeVersion: ch.version,
      version,
    };
  })().catch(() => ({ ...EMPTY_ASSETS }));
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
 * React hook reporting install/update status and the latest downloadable assets:
 *   { present, installedVersion, latestVersion, outOfDate,
 *     firefox, chrome, firefoxVersion, chromeVersion, loading }
 * `present`/`installedVersion` track the page tag (re-checked on the ready
 * event); the asset fields resolve from the repo. `loading` is true until the
 * API call settles so consumers can tell "still resolving" from "no asset".
 */
export function useExtensionStatus() {
  const [info, setInfo] = useState(() => ({
    present: extensionPresent(), installedVersion: extensionVersion(),
  }));
  useEffect(() => {
    const check = () => setInfo({ present: extensionPresent(), installedVersion: extensionVersion() });
    check();
    window.addEventListener('logarium-ext-ready', check);
    return () => window.removeEventListener('logarium-ext-ready', check);
  }, []);

  const [assets, setAssets] = useState({ ...EMPTY_ASSETS, loading: true });
  useEffect(() => {
    let cancelled = false;
    fetchExtensionAssets().then(a => { if (!cancelled) setAssets({ ...a, loading: false }); });
    return () => { cancelled = true; };
  }, []);

  const outOfDate = Boolean(
    info.present && info.installedVersion && assets.version
    && compareVersions(assets.version, info.installedVersion) > 0,
  );
  return {
    present: info.present,
    installedVersion: info.installedVersion,
    latestVersion: assets.version,
    outOfDate,
    firefox: assets.firefox,
    chrome: assets.chrome,
    firefoxVersion: assets.firefoxVersion,
    chromeVersion: assets.chromeVersion,
    loading: assets.loading,
  };
}
