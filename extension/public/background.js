/*
 * Background service worker — privileged cover fetch for the popup.
 *
 * Why this exists: an extension *page* (the popup) is CORS-enforced when it
 * fetches a third-party cover CDN, so most covers fail with a NetworkError, and
 * Cloudflare-gated covers (NovelUpdates) fail with 403 because the browser
 * won't attach the SameSite=Lax `cf_clearance` cookie cross-site. The service
 * worker context is CORS-exempt for hosts in host_permissions, and we attach
 * `cf_clearance` ourselves via a declarativeNetRequest header rule (the cookie
 * value is read with chrome.cookies — same browser, IP and UA as the user, so
 * Cloudflare accepts it).
 *
 * The popup sends { type: 'fetchCover', coverUrl }; we return the image bytes
 * base64-encoded (messages must be JSON-serialisable) for the popup to upload.
 */

const COOKIE_RULE_ID = 1;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'fetchCover' && msg.coverUrl) {
    fetchCover(msg.coverUrl)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: (e && e.message) || 'fetch failed' }));
    return true; // keep the message channel open for the async response
  }
  return false;
});

async function fetchCover(coverUrl) {
  const cfValue = await getCfClearance(coverUrl);
  console.log('[LOG cover] cf_clearance found:', !!cfValue, 'for', coverUrl);

  const ruleApplied = await applyCookieRule(coverUrl, cfValue);
  console.log('[LOG cover] cookie rule applied:', ruleApplied);
  try {
    const res = await fetch(coverUrl, { credentials: 'include' });
    console.log('[LOG cover] fetch status:', res.status, res.headers.get('content-type'));
    if (!res.ok) return { ok: false, reason: `fetch ${res.status}` };
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return { ok: false, reason: `not an image (${contentType || 'unknown type'})` };
    }
    return { ok: true, base64: bufferToBase64(await res.arrayBuffer()), contentType };
  } finally {
    if (ruleApplied) await clearCookieRule();
  }
}

// Read the user's cf_clearance for the cover host. On Firefox (Total Cookie
// Protection) the cookie is partitioned under the novelupdates.com top-level
// site, so the plain unpartitioned lookup misses it — fall back to scanning all
// cf_clearance cookies (incl. partitioned) and matching the cover host.
async function getCfClearance(coverUrl) {
  let host = '';
  try { host = new URL(coverUrl).hostname; } catch { return null; }

  try {
    const direct = await chrome.cookies.get({ url: coverUrl, name: 'cf_clearance' });
    if (direct && direct.value) return direct.value;
  } catch { /* continue */ }

  // Derive the registrable-ish domain (last two labels) for a partition guess.
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
      if (match && match.value) {
        console.log('[LOG cover] cf_clearance via getAll', JSON.stringify(q.partitionKey || 'unpartitioned'));
        return match.value;
      }
    } catch { /* query shape may be unsupported on this browser; try next */ }
  }
  return null;
}

// Inject `cf_clearance` onto the cover request via a transient session rule.
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
