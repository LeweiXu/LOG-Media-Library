const CACHE_PREFIX = 'logarium-session-v1';
const MAX_AGE_MS = 12 * 60 * 60_000;

function cacheKey(area, username) {
  return `${CACHE_PREFIX}:${area}:${encodeURIComponent(username || '')}`;
}

export function readSessionCache(area, username) {
  if (!username) return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(area, username));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.savedAt || Date.now() - saved.savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(cacheKey(area, username));
      return null;
    }
    return saved.data ?? null;
  } catch {
    return null;
  }
}

export function writeSessionCache(area, username, data) {
  if (!username) return false;
  try {
    sessionStorage.setItem(cacheKey(area, username), JSON.stringify({
      savedAt: Date.now(),
      data,
    }));
    return true;
  } catch {
    return false;
  }
}

export function removeSessionCache(area, username) {
  if (!username) return;
  try { sessionStorage.removeItem(cacheKey(area, username)); }
  catch { /* Browser storage can be unavailable. */ }
}

export function clearUserSessionData(username) {
  if (!username) return;
  try {
    const suffix = `:${encodeURIComponent(username)}`;
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(`${CACHE_PREFIX}:`) && key.endsWith(suffix)) keys.push(key);
    }
    keys.forEach(key => sessionStorage.removeItem(key));
  } catch { /* Browser storage can be unavailable. */ }
  window.dispatchEvent(new CustomEvent('logarium-session-cache-clear', {
    detail: { username },
  }));
}
