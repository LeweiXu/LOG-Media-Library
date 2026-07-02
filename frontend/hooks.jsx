import { useEffect, useRef } from 'react';
import { BASE, clearBackendNetworkError, hadBackendNetworkError, markBackendNetworkError } from './api.jsx';

const BACKEND_RECOVERY_TIMEOUT_MS = 5000;

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function backendReachable() {
  try {
    const res = await fetch(`${BASE}/`, {
      cache: 'no-store',
      signal: timeoutSignal(BACKEND_RECOVERY_TIMEOUT_MS),
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

// Re-run `onFocus` whenever the user returns to the app — either by switching
// back to this browser tab (`visibilitychange`) or by refocusing the window
// after using the extension popup (`focus`). This lets a page pick up entries
// that were added elsewhere (notably the browser extension, which writes through
// the same backend from a separate origin) without a manual refresh.
//
// Pass a *silent* refresh so the page updates in place without flashing its
// loading skeleton. Explore intentionally opts out (it doesn't call this hook),
// since its recommendations are seeded/cached and shouldn't reshuffle on focus.
export function useRevalidateOnFocus(onFocus, enabled = true) {
  const cbRef = useRef(onFocus);
  cbRef.current = onFocus;
  const lastRef = useRef(0);
  const probingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const fire = async (force = false) => {
      if (document.visibilityState === 'hidden') return;
      // `focus` and `visibilitychange` can both fire for the same return; collapse
      // the burst so we don't double-fetch.
      const now = Date.now();
      if (!force && now - lastRef.current < 800) return;
      lastRef.current = now;

      if (navigator.onLine === false) {
        markBackendNetworkError();
        return;
      }

      if (hadBackendNetworkError()) {
        if (probingRef.current) return;
        probingRef.current = true;
        const reachable = await backendReachable();
        probingRef.current = false;
        if (!reachable) return;
        clearBackendNetworkError();
        window.location.reload();
        return;
      }

      const ok = await cbRef.current();
      if (ok === false) markBackendNetworkError();
    };
    const onVis = () => { if (document.visibilityState === 'visible') fire(); };
    const onOnline = () => fire(true);
    window.addEventListener('focus', fire);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', fire);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled]);
}
