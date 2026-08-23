import { createContext, useContext } from 'react';

// ── Shared-profile mode ───────────────────────────────────────────────────────
// When a viewer opens someone's share link the whole app runs as normal, reading
// that user's data through their share token (see data/shareSession.js). The
// backend refuses every write for such a token; this context is how the UI knows
// to stop offering writes in the first place.

const ShareContext = createContext({ isShare: false, ownerUsername: '' });

export function ShareProvider({ session, children }) {
  const value = session
    ? { isShare: true, ownerUsername: session.username }
    : { isShare: false, ownerUsername: '' };
  return <ShareContext.Provider value={value}>{children}</ShareContext.Provider>;
}

export function useShare() {
  return useContext(ShareContext);
}

// Convenience for the common case: "is this a read-only view?"
export function useReadOnly() {
  return useContext(ShareContext).isShare;
}
