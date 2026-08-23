// Read-only shared-profile session.
//
// A share link (/s/<token>) drops an opaque token here; api.jsx then sends it
// as the bearer token for every request, so the whole app renders the shared
// user's library. Kept in sessionStorage on purpose: it is per-tab, so opening
// someone's link never disturbs your own login in another tab, and it ends when
// the tab closes.
//
// No imports here (api.jsx and share.jsx both use it) — keep it dependency-free.

const TOKEN_KEY = 'share_token';
const USER_KEY  = 'share_username';

export function readShareSession() {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const username = sessionStorage.getItem(USER_KEY);
    return token && username ? { token, username } : null;
  } catch {
    return null;
  }
}

// The token alone, available before the session's owner is known (the /s/<token>
// route stores it, then asks the API who it belongs to).
export function readShareToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  catch { return ''; }
}

export function writeShareToken(token) {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* storage can be unavailable */ }
}

export function writeShareUsername(username) {
  try { sessionStorage.setItem(USER_KEY, username); } catch { /* storage can be unavailable */ }
}

export function clearShareSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch { /* storage can be unavailable */ }
}
