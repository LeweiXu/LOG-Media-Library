import { useEffect, useRef, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { getShareSession } from '../api.jsx';
import { writeShareToken, writeShareUsername, clearShareSession } from '../data/shareSession.js';

// ── /s/:token ─────────────────────────────────────────────────────────────────
// Landing point for a share link. Stores the token, asks the API who it belongs
// to, and hands the resolved session up to App, which then renders the whole app
// in read-only shared mode. A dead or regenerated link lands here as an error.

export default function ShareLanding({ onResolved }) {
  const { token } = useParams();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      writeShareToken(token);
      try {
        const session = await getShareSession();
        if (!session?.read_only) {
          // A real account token resolving here would mean the link is not a
          // share link at all; don't quietly grant a writable session.
          throw new Error('Not a share link');
        }
        writeShareUsername(session.username);
        onResolved({ username: session.username });
        setDone(true);
      } catch {
        clearShareSession();
        setError('This share link is no longer valid.');
      }
    })();
  }, [token, onResolved]);

  if (done) return <Navigate to="/dashboard" replace />;

  return (
    <div className="share-landing">
      {error
        ? <>
            <p className="share-landing-title">{error}</p>
            <p className="share-landing-note">
              The owner may have regenerated it or turned sharing off. Ask them for a new link.
            </p>
          </>
        : <p className="share-landing-note">Opening shared profile…</p>}
    </div>
  );
}
