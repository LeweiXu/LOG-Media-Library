/*
 * Web-app ↔ extension bridge content script.
 *
 * Injected only into the Logarium web app origins. Lets the website's "Resync
 * Covers" modal drive the extension's headless background sync — cross-browser
 * (content scripts + window.postMessage work in both Chrome and Firefox, unlike
 * `externally_connectable`).
 *
 *   page  → window.postMessage({ logarium:true, dir:'toExt', type:'startSync', … })
 *           → here opens a Port to the background and relays start/cancel
 *   bg    → Port messages (progress/done/error)
 *           → here → window.postMessage({ logarium:true, dir:'fromExt', … }) → page
 *
 * On load it tags the document so the web app can enable its trigger button.
 */
(() => {
  document.documentElement.setAttribute('data-logarium-ext', '1');
  // Expose the installed version so the web app can flag out-of-date installs.
  try {
    const v = chrome.runtime.getManifest().version;
    if (v) document.documentElement.setAttribute('data-logarium-ext-version', v);
  } catch { /* manifest unavailable — version detection just won't run */ }
  window.dispatchEvent(new CustomEvent('logarium-ext-ready'));

  let port = null;

  function closePort() {
    if (port) { try { port.disconnect(); } catch { /* ignore */ } port = null; }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.logarium !== true || data.dir !== 'toExt') return;

    if (data.type === 'startSync') {
      closePort();
      try {
        port = chrome.runtime.connect({ name: 'sync' });
      } catch {
        window.postMessage({ logarium: true, dir: 'fromExt', type: 'error', reason: 'extension unavailable' }, window.location.origin);
        return;
      }
      port.onMessage.addListener((msg) => {
        window.postMessage({ logarium: true, dir: 'fromExt', ...msg }, window.location.origin);
        if (msg && (msg.type === 'done' || msg.type === 'error')) closePort();
      });
      port.onDisconnect.addListener(() => { port = null; });
      port.postMessage({
        type: 'start',
        sources: data.sources,
        token: data.token,
        apiBase: data.apiBase,
      });
    } else if (data.type === 'cancelSync') {
      closePort(); // disconnect → background sees onDisconnect → stops the loop
    } else if (data.type === 'searchNu') {
      // Request/response: relay to the background worker, post the result back
      // tagged with the same id so the page can match it.
      const id = data.id;
      Promise.resolve(chrome.runtime.sendMessage({ type: 'searchNu', query: data.query, token: data.token, apiBase: data.apiBase }))
        .then((resp) => {
          window.postMessage({ logarium: true, dir: 'fromExt', type: 'searchNuResult', id, ...(resp || { ok: false }) }, window.location.origin);
        })
        .catch(() => {
          window.postMessage({ logarium: true, dir: 'fromExt', type: 'searchNuResult', id, ok: false }, window.location.origin);
        });
    } else if (data.type === 'exploreGoodreads') {
      // Same request/response shape as searchNu — load a Goodreads genre shelf
      // first-party and return parsed recommendation items.
      const id = data.id;
      Promise.resolve(chrome.runtime.sendMessage({ type: 'exploreGoodreads', genre: data.genre, token: data.token, apiBase: data.apiBase }))
        .then((resp) => {
          window.postMessage({ logarium: true, dir: 'fromExt', type: 'exploreGoodreadsResult', id, ...(resp || { ok: false }) }, window.location.origin);
        })
        .catch(() => {
          window.postMessage({ logarium: true, dir: 'fromExt', type: 'exploreGoodreadsResult', id, ok: false }, window.location.origin);
        });
    }
  });
})();
