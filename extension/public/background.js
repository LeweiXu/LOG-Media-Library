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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'fetchCover' && msg.coverUrl) {
    fetchCoverBase64(msg.coverUrl)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'fetch failed' }));
    return true; // keep the message channel open for the async response
  }
  return false;
});

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

  const img = document.querySelector('div.seriesimg img');
  const cover_url = img ? normaliseCover(img.getAttribute('src') || img.getAttribute('data-src') || '') : '';

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

  return {
    title, medium, origin, year, cover_url, total, external_id,
    source: 'novelupdates',
    external_url: `https://www.novelupdates.com/series/${slug}/`,
    genres, external_rating, status: 'planned',
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
