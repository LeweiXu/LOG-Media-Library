// Website-side helpers for talking to the Logarium browser extension.
//
// The extension injects a content-script bridge (bridge.js) on this origin that
// (a) tags the document so we can detect it, and (b) relays window.postMessage
// requests to its background worker and posts results back. All messages use
// { logarium: true, dir: 'toExt' | 'fromExt', … }.

import { useEffect, useState } from 'react';

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
    post({ type: 'searchNu', id, query: query.trim() });
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
// Fill these in after publishing/signing the extension. Chrome can't be
// installed from an arbitrary site (Web Store only); Firefox can install from a
// link to the AMO listing or a signed .xpi.

export const EXTENSION_CHROME_URL = '';   // e.g. https://chromewebstore.google.com/detail/…
export const EXTENSION_FIREFOX_URL = 'https://addons.mozilla.org/firefox/downloads/file/4830622/2836703171014861a2fb-1.0.0.xpi';  // e.g. https://addons.mozilla.org/…/logarium/ or a signed .xpi URL

export function isFirefox() {
  return typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
}

/** Best install URL for the current browser, or '' if not configured yet. */
export function extensionInstallUrl() {
  return isFirefox() ? EXTENSION_FIREFOX_URL : EXTENSION_CHROME_URL;
}
