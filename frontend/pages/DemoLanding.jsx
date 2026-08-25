import { useEffect, useRef, useState } from 'react';
import { demoLogin } from '../api.jsx';
import { clearShareSession } from '../data/shareSession.js';

// ── /demo ─────────────────────────────────────────────────────────────────────
// Anyone landing here is signed straight into the public demo account, no form.
// The account is public by design and is wiped and re-seeded from the
// maintainer's library every 24h, so there is nothing to protect here.

export default function DemoLanding({ onAuth }) {
  const [error, setError] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      // A share session in this tab would otherwise keep masking the token we
      // are about to store (api.jsx prefers it), leaving the demo unreachable.
      clearShareSession();
      try {
        const { access_token, username } = await demoLogin();
        localStorage.setItem('auth_token', access_token);
        localStorage.setItem('auth_username', username);
        onAuth(access_token, username);
      } catch {
        setError('The demo account is unavailable right now.');
      }
    })();
  }, [onAuth]);

  return (
    <div className="share-landing">
      {error
        ? <>
            <p className="share-landing-title">{error}</p>
            <p className="share-landing-note">
              Try again in a moment, or register your own account from the home page.
            </p>
          </>
        : <p className="share-landing-note">Signing in to the demo…</p>}
    </div>
  );
}
