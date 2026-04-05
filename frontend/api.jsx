export const BASE = 'http://localhost:6443';

const getToken = () => localStorage.getItem('auth_token');

async function req(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  // 204 No Content has no body
  if (res.status === 204) return null;
  return res.json();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json(); // { access_token, token_type }
}

export async function register(username, email, password) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json(); // { username, email }
}

// ── Entries ───────────────────────────────────────────────────────────────────

export const getEntries = (params = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))
  ).toString();
  return req(`/entries${qs ? '?' + qs : ''}`);
};

export const getEntry    = (id)        => req(`/entries/${id}`);
export const createEntry = (data)      => req('/entries', { method: 'POST', body: JSON.stringify(data) });
export const updateEntry = (id, data)  => req(`/entries/${id}`, { method: 'PUT',  body: JSON.stringify(data) });
export const deleteEntry = (id)        => req(`/entries/${id}`, { method: 'DELETE' });

export const searchMedia = (title, medium = '') => {
  const qs = new URLSearchParams({ title, ...(medium && { medium }) }).toString();
  return req(`/search?${qs}`);
};

export const getStats = () => req('/stats');
