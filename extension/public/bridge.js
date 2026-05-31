/*
 * Web-app ↔ extension bridge content script.
 *
 * Injected only into the Logarium web app origins. It lets the site's "Resync
 * NU covers" button trigger the extension without the page knowing the
 * extension's id — cross-browser (Chrome and Firefox both support content
 * scripts + window.postMessage, unlike `externally_connectable`).
 *
 *   page → window.postMessage({ logarium: 'openSync' }) → here → background
 *
 * On load it tags the document so the web app can enable the trigger button.
 */
(() => {
  document.documentElement.setAttribute('data-logarium-ext', '1');
  // Fire after the attribute is set, in case the app already mounted.
  window.dispatchEvent(new CustomEvent('logarium-ext-ready'));

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.logarium !== 'openSync') return;
    try {
      chrome.runtime.sendMessage({ type: 'openSync' });
    } catch {
      /* extension context reloading — ignore */
    }
  });
})();
