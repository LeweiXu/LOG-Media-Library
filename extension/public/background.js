/*
 * Background service worker.
 *
 * Two jobs, both needing the worker's privileges (CORS-exempt fetch for
 * host_permissions hosts, chrome.cookies, declarativeNetRequest, chrome.tabs/
 * scripting):
 *
 *   1. fetchCover (popup) — fetch one cover first-party (attaching the user's
 *      cf_clearance for Cloudflare hosts) so the popup can upload it on add.
 *   2. Cover resync (website) — driven over a Port opened by the bridge content
 *      script. The website renders the UI; this worker does the work headlessly
 *      (lists entries, re-scrapes NovelUpdates pages for their real cover URL,
 *      fetches + uploads each cover, patches changed URLs) and streams progress
 *      back over the Port. Cancelling = the bridge disconnects the Port.
 */

const COOKIE_RULE_ID = 1;

// ── Single-cover fetch (popup) ────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'fetchCover' && msg.coverUrl) {
    fetchCoverBase64(msg.coverUrl)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'fetch failed' }));
    return true; // keep the message channel open for the async response
  }
  // The injected overlay couldn't load its iframe (page CSP blocks extension
  // frames) → fall back to a centred window.
  if (msg && msg.type === 'overlayFallback') {
    openPopupWindow(sender && sender.tab ? sender.tab : null);
    return false;
  }
  // NovelUpdates keyword search, relayed by the bridge from the web app. NU's
  // Series Finder is Cloudflare-blocked server-side, so we run it here first-
  // party (with the user's cf_clearance) as a silent search fallback.
  if (msg && msg.type === 'searchNu' && msg.query) {
    searchNovelUpdates(msg.query, msg.token, msg.apiBase)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'search failed' }));
    return true;
  }
  // Goodreads Explore fallback: load a genre shelf first-party and return parsed
  // recommendation items (used when the server-side shelf fetch is blocked).
  if (msg && msg.type === 'exploreGoodreads') {
    exploreGoodreads(msg.genre)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'explore failed' }));
    return true;
  }
  // NovelUpdates Explore fallback: load a Top-Series ranking first-party (NU is
  // Cloudflare-blocked server-side) and return parsed recommendation items,
  // caching each (cross-site-403) cover so it displays on the website.
  if (msg && msg.type === 'exploreNu') {
    exploreNovelUpdates(msg.rank, msg.token, msg.apiBase, msg.seed, msg.limit)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'explore failed' }));
    return true;
  }
  // NovelUpdates detail upgrade: open a series page first-party and return the
  // full-resolution cover URL from the series page before the website creates
  // an entry from a listing-page recommendation.
  if (msg && msg.type === 'nuSeries' && msg.url) {
    scrapeNovelUpdatesSeries(msg.url, msg.token, msg.apiBase)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'series scrape failed' }));
    return true;
  }
  // ── Overlay-mode delegation ──
  // When the UI runs as an in-page overlay (iframe), Firefox sandboxes it: no
  // chrome.tabs/scripting and no cross-origin fetch. So the iframe asks the
  // background (full privileges) to do the page read / create / cover cache.
  if (msg && msg.type === 'embedLoadEntry') {
    embedLoadEntry(msg.tabId, msg.token, msg.apiBase)
      .then(sendResponse).catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'load failed' }));
    return true;
  }
  if (msg && msg.type === 'embedFetchEntry') {
    embedFetchEntry(msg.tabId, msg.token, msg.apiBase)
      .then(sendResponse).catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'load failed' }));
    return true;
  }
  if (msg && msg.type === 'embedCreateEntry') {
    embedCreateEntry(msg.payload, msg.token, msg.apiBase)
      .then(sendResponse).catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'create failed' }));
    return true;
  }
  if (msg && msg.type === 'embedUpdateEntry') {
    embedUpdateEntry(msg.id, msg.payload, msg.token, msg.apiBase)
      .then(sendResponse).catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'update failed' }));
    return true;
  }
  if (msg && msg.type === 'embedCacheCover') {
    embedCacheCover(msg.coverUrl, msg.token, msg.apiBase)
      .then(sendResponse).catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'cache failed' }));
    return true;
  }
  return false;
});

// URL → how to read the page. NU pages are DOM-scraped; the API-backed sites
// resolve via the backend's /search/from-url. Mirrors src/lib/site.js.
function detectSiteUrl(url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { kind: 'unsupported' }; }
  if (host.includes('novelupdates.com')) return { kind: 'dom' };
  const API = [
    'themoviedb.org', 'anilist.co', 'myanimelist.net', 'kitsu.io', 'kitsu.app',
    'mangadex.org', 'mangaupdates.com', 'baka-updates.com', 'igdb.com', 'rawg.io',
    'books.google.com', 'play.google.com', 'openlibrary.org',
    'comicvine.gamespot.com', 'vndb.org', 'jjwxc.net', 'qidian.com', 'imdb.com',
    'goodreads.com',
  ];
  return API.some((d) => host.includes(d)) ? { kind: 'api' } : { kind: 'unsupported' };
}

// Resolve a tab into a prefilled entry: DOM-scrape NU-style sites, otherwise
// relay to the backend's /search/from-url. Returns the entry object or null.
async function scrapeOrFetchEntry(tab, site, token, apiBase) {
  if (site.kind === 'dom') {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: scrapeNovelUpdates,
    });
    return result && result.title ? result : null;
  }
  const res = await fetch(`${apiBase}/search/from-url?url=${encodeURIComponent(tab.url)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return null;
  const data = await res.json();
  const first = Array.isArray(data) && data[0] ? { ...data[0], status: 'planned' } : null;
  return first && first.title ? first : null;
}

async function embedLoadEntry(tabId, token, apiBase) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!tab || !tab.url) return { ok: false, reason: 'no tab' };

  // 1) Existence check by the page URL first — if the source link is already in
  //    the library, skip the scrape/API fetch entirely (we'll edit it instead).
  const existingByTab = await apiFindEntryByUrl(apiBase, token, tab.url);
  if (existingByTab) return { ok: true, existing: existingByTab, entry: null };

  // 2) Not in the library → read the media details.
  const site = detectSiteUrl(tab.url);
  if (site.kind === 'unsupported') return { ok: false, reason: 'unsupported' };
  const entry = await scrapeOrFetchEntry(tab, site, token, apiBase);
  if (!entry) return { ok: false, reason: 'nofind' };

  // 3) Second check against the resolved canonical URL (e.g. a NU chapter page
  //    resolves to the series URL that was actually stored).
  let existing = null;
  if (entry.external_url && entry.external_url !== tab.url) {
    existing = await apiFindEntryByUrl(apiBase, token, entry.external_url);
  }
  return { ok: true, entry, existing };
}

// Fetch the media details only (no existence short-circuit) — used by the popup
// "New Entry" action when the page's link already matches a library entry.
async function embedFetchEntry(tabId, token, apiBase) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!tab || !tab.url) return { ok: false, reason: 'no tab' };
  const site = detectSiteUrl(tab.url);
  if (site.kind === 'unsupported') return { ok: false, reason: 'unsupported' };
  const entry = await scrapeOrFetchEntry(tab, site, token, apiBase);
  return entry ? { ok: true, entry } : { ok: false, reason: 'nofind' };
}

async function embedUpdateEntry(id, payload, token, apiBase) {
  const res = await fetch(`${apiBase}/entries/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, reason: `${res.status} ${await res.text()}` };
  return { ok: true, entry: await res.json() };
}

async function embedCreateEntry(payload, token, apiBase) {
  const res = await fetch(`${apiBase}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, reason: `${res.status} ${await res.text()}` };
  return { ok: true, entry: await res.json() };
}

async function embedCacheCover(coverUrl, token, apiBase) {
  if (!coverUrl) return { ok: false, reason: 'no cover' };
  const cover = await fetchCoverData(coverUrl);
  if (!cover.ok) return { ok: false, reason: cover.reason };
  try { await apiUploadCover(apiBase, token, coverUrl, cover.blob); return { ok: true }; }
  catch (e) { return { ok: false, reason: (e && e.message) || 'upload failed' }; }
}

// Clicking the toolbar icon injects the login/add UI as an in-page overlay on
// the current tab (no new window). If injection is blocked (about:/store/PDF
// pages), fall back to a centred window.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectOverlay,
      args: [tab.id, chrome.runtime.getURL('popup.html')],
    });
  } catch {
    openPopupWindow(tab);
  }
});

// Injected into the page (isolated world). Mounts a fixed, dimmed overlay with
// an iframe of the extension popup, centred modal-style. Toggles off if already
// open. If the iframe doesn't report ready (page CSP blocks extension frames),
// it tears down and asks the background for a windowed fallback.
function injectOverlay(tabId, popupUrl) {
  const ID = 'logarium-ext-overlay';
  const existing = document.getElementById(ID);
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = ID;
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;';

  const frame = document.createElement('iframe');
  frame.src = `${popupUrl}?tabId=${tabId}&embed=1`;
  frame.style.cssText = 'width:460px;max-width:96vw;height:560px;max-height:92vh;border:1px solid #2a2d31;background:#0e0f11;box-shadow:0 12px 48px rgba(0,0,0,0.55);';
  overlay.appendChild(frame);

  let ready = false;
  const close = () => { window.removeEventListener('message', onMsg); overlay.remove(); };
  const onMsg = (e) => {
    if (!e || !e.data) return;
    if (e.data.logariumExtReady) ready = true;
    else if (e.data.logariumExtClose) close();
    // The popup reports its content height so the iframe fits the form without
    // an inner scrollbar (capped at 92vh by max-height).
    else if (typeof e.data.logariumExtHeight === 'number') {
      frame.style.height = Math.max(140, e.data.logariumExtHeight) + 'px';
    }
  };
  window.addEventListener('message', onMsg);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.documentElement.appendChild(overlay);

  setTimeout(() => {
    if (!ready) {
      close();
      try { chrome.runtime.sendMessage({ type: 'overlayFallback' }); } catch (e) { /* ignore */ }
    }
  }, 2500);
}

async function openPopupWindow(srcTab) {
  const W = 460, H = 880;
  let left, top;
  try {
    const cur = await chrome.windows.getCurrent();
    if (cur && cur.width && cur.height) {
      left = Math.round(cur.left + (cur.width - W) / 2);
      top = Math.round(cur.top + (cur.height - H) / 2);
    }
  } catch { /* fall back to the browser's default placement */ }

  const suffix = srcTab && srcTab.id != null ? `?tabId=${srcTab.id}` : '';
  await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html${suffix}`),
    type: 'popup',
    width: W,
    height: H,
    ...(left != null && top != null ? { left, top } : {}),
  });
}

// Fetch a cover and return it base64-encoded (messages must be serialisable).
async function fetchCoverBase64(coverUrl) {
  const data = await fetchCoverData(coverUrl);
  if (!data.ok) return data;
  const buffer = await data.blob.arrayBuffer();
  return { ok: true, base64: bufferToBase64(buffer), contentType: data.contentType };
}

// Core privileged fetch, shared by the popup path and the resync path. Returns
// { ok: true, blob, contentType } or { ok: false, reason }.
async function fetchCoverData(coverUrl) {
  const cfValue = await getCfClearance(coverUrl);
  const ruleApplied = await applyCookieRule(coverUrl, cfValue);
  try {
    const res = await fetch(coverUrl, { credentials: 'include' });
    if (!res.ok) return { ok: false, reason: `fetch ${res.status}` };
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return { ok: false, reason: `not an image (${contentType || 'unknown type'})` };
    }
    return { ok: true, blob: await res.blob(), contentType };
  } finally {
    if (ruleApplied) await clearCookieRule();
  }
}

// ── Cover resync (website-driven, over a Port) ────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sync') return;
  let cancelled = false;
  port.onDisconnect.addListener(() => { cancelled = true; });
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'start') {
      runSync(msg, port, () => cancelled).catch((e) => {
        try { port.postMessage({ type: 'error', reason: (e && e.message) || 'sync failed' }); } catch { /* gone */ }
      });
    }
  });
});

async function runSync({ sources, token, apiBase }, port, isCancelled) {
  const send = (m) => { try { port.postMessage(m); } catch { /* port gone */ } };
  if (!token || !apiBase) { send({ type: 'error', reason: 'not signed in' }); return; }

  let entries;
  try {
    entries = await apiGetEntries(apiBase, token);
  } catch (e) {
    send({ type: 'error', reason: `couldn't list entries: ${e.message}` });
    return;
  }

  const sourceSet = new Set(sources || []);
  const targets = entries.filter((e) => {
    if (!sourceSet.has(e.source)) return false;
    if (e.source === 'novelupdates') return !!e.external_url; // can re-scrape for the real URL
    return !!e.cover_url;                                     // others need an existing cover
  });

  const total = targets.length;
  let cached = 0, updated = 0, failed = 0;
  send({ type: 'progress', done: 0, total, cached, updated, failed });

  for (let i = 0; i < total; i++) {
    if (isCancelled()) return;
    const e = targets[i];
    send({ type: 'progress', done: i, total, cached, updated, failed, current: e.title });

    let coverUrl = e.cover_url || '';
    // Existing NU entries hold the dead /imgmid/ URL — re-scrape the page for
    // the real /images/ one. Other sources already store a usable cover URL.
    if (e.source === 'novelupdates' && (!coverUrl || coverUrl.includes('/imgmid/'))) {
      const scraped = await scrapeInTab(e.external_url, isCancelled);
      coverUrl = (scraped && scraped.cover_url) || '';
      await delay(500);
    }
    if (isCancelled()) return;
    if (!coverUrl) { failed++; continue; }

    const cover = await fetchCoverData(coverUrl);
    if (!cover.ok) { failed++; continue; }
    try {
      await apiUploadCover(apiBase, token, coverUrl, cover.blob);
      cached++;
      if (coverUrl !== e.cover_url) {
        await apiPatchCover(apiBase, token, e.id, coverUrl);
        updated++;
      }
    } catch {
      failed++;
    }
  }

  if (!isCancelled()) send({ type: 'done', done: total, total, cached, updated, failed });
}

// ── Backend API (raw fetch — the SW has no localStorage, so token is passed) ──

async function apiGetEntries(apiBase, token) {
  const out = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(`${apiBase}/entries?limit=2000&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const page = await res.json();
    const items = page.items || page.entries || page.results || (Array.isArray(page) ? page : []);
    out.push(...items);
    if (items.length < 2000) break;
    offset += items.length;
  }
  return out;
}

// Returns the user's existing entry whose external URL matches, or null.
async function apiFindEntryByUrl(apiBase, token, externalUrl) {
  if (!externalUrl) return null;
  try {
    const res = await fetch(
      `${apiBase}/entries?external_url=${encodeURIComponent(externalUrl)}&limit=1`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const item = data && data.items && data.items[0];
    // Confirm the match in case the backend ignored the (unknown) filter param.
    return item && item.external_url === externalUrl ? item : null;
  } catch {
    return null;
  }
}

async function apiUploadCover(apiBase, token, coverUrl, blob) {
  const body = new FormData();
  body.append('cover_url', coverUrl);
  body.append('image', blob, 'cover.jpg');
  const res = await fetch(`${apiBase}/covers/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) throw new Error(`upload ${res.status}`);
}

async function apiPatchCover(apiBase, token, id, coverUrl) {
  const res = await fetch(`${apiBase}/entries/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids: [id], patch: { cover_url: coverUrl } }),
  });
  if (!res.ok) throw new Error(`patch ${res.status}`);
}

// ── NovelUpdates keyword search (background tab + injected scraper) ────────────

// A service worker has no DOMParser and NU's markup needs real parsing (entity
// decoding, precise cover/origin/rating/genre/synopsis selectors), so we run the
// Series Finder in a background tab and scrape its DOM — mirroring
// backend/services/search_providers/novelupdates.py. Then we fetch + cache each
// cover first-party (NU covers 403 cross-site) so they display on the website.
async function searchNovelUpdates(query, token, apiBase) {
  const url = `https://www.novelupdates.com/series-finder/?sf=1&sh=${encodeURIComponent(query)}&sort=sdate&order=desc`;
  const tab = await chrome.tabs.create({ url, active: false });
  let results = [];
  try {
    await waitForComplete(tab.id);
    for (let attempt = 0; attempt < 5; attempt++) {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeNuSearchResults,
      });
      if (result && result.ready) { results = result.results || []; break; }
      await delay(2000); // still on the "Just a moment…" challenge — wait it out
    }
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'search failed' };
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
  }

  // Cache covers first-party so the cross-site 403 falls back to our cached copy.
  if (token && apiBase && results.length) {
    await cacheCoversBatch(results.map((r) => r.cover_url).filter(Boolean), token, apiBase);
  }
  return { ok: true, results };
}

// NovelUpdates Explore: mirror the backend discovery loop. It shuffles logical
// pages 1..10 using the reroll seed, maps those pages to NU ranking modes, opens
// each ranking first-party in the background, de-dupes by title|medium, and
// stops once enough unique recommendations have been collected.
async function exploreNovelUpdates(rank, token, apiBase, seed, limit) {
  const target = Math.max(Number(limit) || 30, 30);
  const ranks = rank ? [rank] : shuffledNuRanks(seed);
  const combined = [];
  const seen = new Set();

  for (const r of ranks) {
    const results = await scrapeNovelUpdatesRanking(r);
    for (const item of results) {
      const key = `${(item.title || '').toLowerCase().trim()}|${item.medium || ''}`;
      if (!key.trim() || seen.has(key)) continue;
      seen.add(key);
      combined.push(item);
      if (combined.length >= target) break;
    }
    if (combined.length >= target) break;
  }

  // Cache covers first-party so the cross-site 403 falls back to our cached copy.
  if (token && apiBase && combined.length) {
    await cacheCoversBatch(combined.map((r2) => r2.cover_url).filter(Boolean), token, apiBase);
  }
  return { ok: true, results: combined };
}

function shuffledNuRanks(seed) {
  const pages = Array.from({ length: 10 }, (_, i) => i + 1);
  const rng = mulberry32(Number(seed) >>> 0);
  for (let i = pages.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pages[i], pages[j]] = [pages[j], pages[i]];
  }
  return pages.map(page => page === 2 ? 'sixmonths' : page === 3 ? 'popular' : 'popmonth');
}

function mulberry32(seed) {
  return function next() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function scrapeNovelUpdatesRanking(rank) {
  const r = ['popmonth', 'sixmonths', 'popular'].includes(rank) ? rank : 'popmonth';
  const url = `https://www.novelupdates.com/series-ranking/?rank=${r}`;
  const tab = await chrome.tabs.create({ url, active: false });
  let results = [];
  try {
    await waitForComplete(tab.id);
    for (let attempt = 0; attempt < 5; attempt++) {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeNuSearchResults,
      });
      if (result && result.ready) { results = result.results || []; break; }
      await delay(2000); // still on the "Just a moment…" challenge — wait it out
    }
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'explore failed' };
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
  }

  return results;
}

// Cache a batch of covers concurrently. All NU search covers share one host, so
// we set ONE cf_clearance rule for that host up front. Per-URL session rules (as
// fetchCoverData uses for single covers) would stomp each other under
// concurrency — one fetch's cleanup removes another's rule — so most would 403.
async function cacheCoversBatch(coverUrls, token, apiBase) {
  if (!coverUrls.length) return;
  const cfValue = await getCfClearance(coverUrls[0]);
  const ruleApplied = await applyCookieRuleForHost(coverUrls[0], cfValue);
  let cached = 0, failed = 0;
  try {
    await Promise.allSettled(coverUrls.map(async (url) => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.startsWith('image/')) { failed++; return; }
        await apiUploadCover(apiBase, token, url, await res.blob());
        cached++;
      } catch { failed++; }
    }));
  } finally {
    if (ruleApplied) await clearCookieRule();
  }
  console.log(`[LOG] NU search: cached ${cached}/${coverUrls.length} covers (failed ${failed}), cf_clearance=${!!cfValue}`);
}

// Like applyCookieRule but matches every URL on the host (||host/), so a single
// rule covers a whole concurrent batch without per-URL churn.
async function applyCookieRuleForHost(sampleUrl, cfValue) {
  if (!cfValue) return false;
  let host = '';
  try { host = new URL(sampleUrl).hostname; } catch { return false; }
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [COOKIE_RULE_ID],
      addRules: [{
        id: COOKIE_RULE_ID,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'cookie', operation: 'set', value: `cf_clearance=${cfValue}` }] },
        condition: { urlFilter: `||${host}/` },
      }],
    });
    return true;
  } catch {
    return false;
  }
}

// Injected into the Series Finder page. Returns { ready, results }. `ready` is
// false while Cloudflare's interstitial is still showing so the caller retries.
// Mirrors the selectors in backend search_providers/novelupdates.py.
function scrapeNuSearchResults() {
  if (/just a moment/i.test(document.title || '') || document.readyState === 'loading') {
    return { ready: false };
  }

  const ORIGIN = { CN: 'Chinese', KR: 'Korean', JP: 'Japanese' };
  const norm = (src) => {
    if (!src) return '';
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('/')) return 'https://cdn.novelupdates.com' + src;
    return src;
  };

  const results = [];
  for (const box of Array.from(document.querySelectorAll('div.search_main_box_nu')).slice(0, 20)) {
    const titleA = box.querySelector('div.search_title a');
    if (!titleA) continue;
    const title = titleA.textContent.trim();          // textContent decodes &#8211; etc.
    if (!title) continue;
    const external_url = titleA.getAttribute('href') || '';
    const slug = (external_url.match(/\/series\/([^/?#]+)/) || [])[1] || '';

    const img = box.querySelector('div.search_img_nu img');
    const cover_url = img ? norm(img.getAttribute('src') || img.getAttribute('data-src') || '') : '';

    let external_id = slug;
    const addtolist = box.querySelector('div.img_addtolist');
    if (addtolist) {
      const m = (addtolist.getAttribute('onclick') || '').match(/show_rl_genre_nu\('(\d+)'/);
      if (m) external_id = m[1];
    }

    let total = '';
    let last_updated = '';
    for (const span of box.querySelectorAll('span.ss_desk')) {
      const icon = span.querySelector('i[title]');
      if (!icon) continue;
      const it = icon.getAttribute('title') || '';
      const txt = span.textContent.trim();
      if (it === 'Chapter Count') { const m = txt.match(/(\d[\d,]*)/); if (m) total = m[1].replace(/,/g, ''); }
      else if (it === 'Last Updated') { const m = txt.match(/(\d{2}-\d{2}-\d{4})/); if (m) last_updated = m[1]; }
    }
    let year = '';
    const ym = last_updated.match(/(\d{4})$/); if (ym) year = ym[1];

    const genres = Array.from(box.querySelectorAll('.search_genre a[href*="/genre/"]'))
      .map((a) => a.textContent.trim()).filter(Boolean);

    let origin = '';
    let external_rating = null;
    const ratingsBox = box.querySelector('.search_ratings');
    if (ratingsBox) {
      const langSpan = ratingsBox.querySelector('span');
      if (langSpan) origin = ORIGIN[langSpan.textContent.trim().toUpperCase()] || '';
      const rm = ratingsBox.textContent.match(/\((\d+(?:\.\d+)?)\)/);
      if (rm) external_rating = Math.round(parseFloat(rm[1]) * 2 * 10) / 10;
    }

    // Synopsis: the visible first paragraph is a bare text node in
    // ".search_body_nu" and the continuation lives in a hidden ".testhide"
    // block, so take the whole body and strip its structural children +
    // "more>>/<<less" toggles. Fall back to a genres/updated summary.
    let description = '';
    const body = box.querySelector('.search_body_nu');
    if (body) {
      const clone = body.cloneNode(true);
      clone.querySelectorAll('.search_title, .search_stats, .search_genre, .dots, .morelink, .moreless, span.list, a').forEach((e) => e.remove());
      description = clone.textContent.replace(/\s+/g, ' ').replace(/(more>>|<<\s*less)\s*$/i, '').trim();
    }
    if (!description) {
      const parts = [];
      if (genres.length) parts.push('Genres: ' + genres.join(', '));
      if (last_updated) parts.push('Last updated: ' + last_updated);
      description = parts.join(' | ');
    }

    results.push({
      title,
      medium: 'Web Novel',
      source: 'novelupdates',
      origin,
      year,
      cover_url,
      total,
      external_id,
      external_url,
      genres: genres.join(', '),
      external_rating,
      description: description || null,
    });
  }
  return { ready: true, results };
}

// ── Goodreads Explore shelf (background tab + injected scraper) ────────────────

// Slugify a genre name into a Goodreads shelf slug ("Science Fiction" →
// "science-fiction"); fall back to the general fiction shelf.
function goodreadsShelfSlug(genre) {
  const slug = (genre || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'fiction';
}

async function exploreGoodreads(genre) {
  const url = `https://www.goodreads.com/shelf/show/${goodreadsShelfSlug(genre)}`;
  const tab = await chrome.tabs.create({ url, active: false });
  let results = [];
  try {
    await waitForComplete(tab.id);
    for (let attempt = 0; attempt < 4; attempt++) {
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeGoodreadsShelf,
      });
      if (result && result.ready) { results = result.results || []; break; }
      await delay(2000); // still loading / interstitial — wait it out
    }
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'explore failed' };
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
  }
  return { ok: true, results };
}

// Injected into a Goodreads shelf page. Mirrors backend
// search_providers/goodreads.py `_parse_shelf`. Returns { ready, results }.
function scrapeGoodreadsShelf() {
  if (/just a moment|checking your browser/i.test(document.title || '') || document.readyState === 'loading') {
    return { ready: false };
  }
  const rows = document.querySelectorAll('div.elementList');
  if (!rows.length) return { ready: false };

  const upgrade = (src) => (src || '').replace(/\._S[XY]\d+_(?=\.)/, '');
  const bookId = (href) => { const m = (href || '').match(/\/book\/show\/(\d+)/); return m ? m[1] : ''; };

  const results = [];
  for (const row of Array.from(rows).slice(0, 30)) {
    const link = row.querySelector('a.bookTitle') || row.querySelector('a.leftAlignedImage');
    if (!link) continue;
    const href = link.getAttribute('href') || '';
    const title = (link.textContent || link.getAttribute('title') || '').trim().replace(/\s*\([^()]*,\s*#[0-9.]+\)\s*$/, '');
    if (!title || !href.includes('/book/show/')) continue;

    const img = row.querySelector('img');
    const cover_url = img ? upgrade(img.getAttribute('src') || '') : '';

    let year = '';
    let external_rating = null;
    const grey = row.querySelector('.greyText.smallText') || row.querySelector('.greyText');
    if (grey) {
      const t = grey.textContent || '';
      const rm = t.match(/avg rating\s*([\d.]+)/);
      if (rm) external_rating = Math.round(parseFloat(rm[1]) * 2 * 10) / 10;
      const ym = t.match(/published\s*(\d{4})/);
      if (ym) year = ym[1];
    }

    results.push({
      title,
      medium: 'Book',
      source: 'goodreads',
      origin: '',
      year,
      cover_url,
      total: '',
      external_id: bookId(href),
      external_url: href.startsWith('/') ? `https://www.goodreads.com${href}` : href,
      genres: '',
      external_rating,
      description: null,
    });
  }
  return { ready: true, results };
}

// ── NovelUpdates re-scrape (background tab + injected scraper) ─────────────────

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function waitForComplete(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') finish(); };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(finish, timeout);
  });
}

async function scrapeInTab(url, isCancelled) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForComplete(tab.id);
    for (let attempt = 0; attempt < 4; attempt++) {
      if (isCancelled && isCancelled()) return null;
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeNovelUpdates,
      });
      if (result && result.title) return result;
      await delay(2500); // still on the "Just a moment…" challenge — wait it out
    }
  } catch { /* fall through */ } finally {
    try { await chrome.tabs.remove(tab.id); } catch { /* ignore */ }
  }
  return null;
}

async function scrapeNovelUpdatesSeries(url, token, apiBase) {
  const entry = await scrapeInTab(url);
  if (entry && entry.cover_url && token && apiBase) {
    try {
      const cover = await fetchCoverData(entry.cover_url);
      if (cover.ok) await apiUploadCover(apiBase, token, entry.cover_url, cover.blob);
    } catch { /* cover caching is best-effort; the URL is still useful */ }
  }
  return entry ? { ok: true, entry } : { ok: false, reason: 'nofind' };
}

// Self-contained NovelUpdates series-page scraper, injected into the page world
// via executeScript. MUST stay in sync with extension/src/lib/scrapers.js and
// backend/services/url_scrapers/novelupdates.py (same selectors).
function scrapeNovelUpdates() {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.trim() : '';
  };
  const normaliseCover = (src) => {
    if (!src) return '';
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('/')) return 'https://cdn.novelupdates.com' + src;
    return src;
  };

  const title = text('div.seriestitlenu');
  if (!title) return null;

  const slugMatch = location.pathname.match(/\/series\/([^/?#]+)/);
  const slug = slugMatch ? slugMatch[1] : '';

  // Find the cover by hunting for any <img> on the page that points at the
  // NovelUpdates image CDN — wherever it sits, whatever the format. Covers can
  // lazy-load, so check the common src-holding attributes, not just `src`.
  // The first `cdn.novelupdates.com/images` link wins.
  let cover_url = '';
  const COVER_ATTRS = ['src', 'data-src', 'data-cfsrc', 'data-lazy-src', 'data-original'];
  for (const el of document.querySelectorAll('img')) {
    for (const attr of COVER_ATTRS) {
      const candidate = normaliseCover(el.getAttribute(attr) || '');
      if (candidate.includes('cdn.novelupdates.com/images')) { cover_url = candidate; break; }
    }
    if (!cover_url) {
      const first = (el.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0] || '';
      const candidate = normaliseCover(first);
      if (candidate.includes('cdn.novelupdates.com/images')) cover_url = candidate;
    }
    if (cover_url) break;
  }
  if (!cover_url) {
    const img = document.querySelector('div.seriesimg img');
    if (img) {
      for (const attr of COVER_ATTRS) {
        const candidate = normaliseCover(img.getAttribute(attr) || '');
        if (candidate) { cover_url = candidate; break; }
      }
    }
  }

  const postId = document.querySelector('#mypostid');
  const external_id = (postId && postId.value) ? postId.value : slug;

  const typeText = text('#showtype');
  const medium = typeText.includes('Light Novel') ? 'Light Novel' : 'Web Novel';

  const lang = text('#showlang');
  const origin = ['Chinese', 'Korean', 'Japanese'].includes(lang) ? lang : '';

  let year = '';
  const yearMatch = text('#edityear').match(/(\d{4})/);
  if (yearMatch) year = yearMatch[1];

  let total = '';
  const totalMatch = text('#editstatus').match(/(\d+)\s*Chapter/);
  if (totalMatch) total = totalMatch[1];

  const genres = Array.from(document.querySelectorAll('#seriesgenre a.genre'))
    .map((a) => a.textContent.trim())
    .filter(Boolean)
    .join(', ');

  let external_rating = '';
  const ratingMatch = document.body.textContent.match(/(\d(?:\.\d+)?)\s*\/\s*5/);
  if (ratingMatch) external_rating = Math.round(parseFloat(ratingMatch[1]) * 2 * 10) / 10;

  // Full synopsis lives in #editdescription.
  const descEl = document.querySelector('#editdescription');
  const description = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : '';

  return {
    title, medium, origin, year, cover_url, total, external_id,
    source: 'novelupdates',
    external_url: `https://www.novelupdates.com/series/${slug}/`,
    genres, external_rating, description: description || null, status: 'planned',
  };
}

// ── cf_clearance cookie reading + injection (Cloudflare covers) ────────────────

async function getCfClearance(coverUrl) {
  let host = '';
  try { host = new URL(coverUrl).hostname; } catch { return null; }

  try {
    const direct = await chrome.cookies.get({ url: coverUrl, name: 'cf_clearance' });
    if (direct && direct.value) return direct.value;
  } catch { /* continue */ }

  const root = host.split('.').slice(-2).join('.');
  const queries = [
    { name: 'cf_clearance' },
    { name: 'cf_clearance', partitionKey: { topLevelSite: `https://${root}` } },
    { name: 'cf_clearance', partitionKey: {} },
    { name: 'cf_clearance', firstPartyDomain: root },
  ];
  for (const q of queries) {
    try {
      const all = await chrome.cookies.getAll(q);
      const match = (all || []).find((c) => {
        const d = (c.domain || '').replace(/^\./, '');
        return host === d || host.endsWith(`.${d}`);
      });
      if (match && match.value) return match.value;
    } catch { /* query shape may be unsupported on this browser; try next */ }
  }
  return null;
}

async function applyCookieRule(coverUrl, cfValue) {
  if (!cfValue) return false;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [COOKIE_RULE_ID],
      addRules: [{
        id: COOKIE_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'cookie', operation: 'set', value: `cf_clearance=${cfValue}` }],
        },
        condition: { urlFilter: coverUrl },
      }],
    });
    return true;
  } catch {
    return false;
  }
}

async function clearCookieRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [COOKIE_RULE_ID] });
  } catch {
    /* ignore */
  }
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
