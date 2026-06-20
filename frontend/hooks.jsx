import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    if (!enabled) return undefined;
    const fire = () => {
      if (document.visibilityState === 'hidden') return;
      // `focus` and `visibilitychange` can both fire for the same return; collapse
      // the burst so we don't double-fetch.
      const now = Date.now();
      if (now - lastRef.current < 800) return;
      lastRef.current = now;
      cbRef.current();
    };
    const onVis = () => { if (document.visibilityState === 'visible') fire(); };
    window.addEventListener('focus', fire);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', fire);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled]);
}
