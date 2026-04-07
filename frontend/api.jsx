export const BASE = import.meta.env.VITE_API_BASE;

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

export async function changePassword(currentPassword, newPassword) {
  return req('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
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

export async function exportEntries() {
  const res = await fetch(`${BASE}/entries/export`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status} ${res.statusText}`);
  return res.blob();
}

export async function previewImport(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/entries/import/preview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

export async function confirmImport(payload) {
  const res = await fetch(`${BASE}/entries/import/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

/**
 * Start an auto-import SSE stream. Returns { reader, abort }.
 * - onEvent(event): called for each parsed SSE event object
 * - Call abort() to cancel mid-stream
 */
export async function startAutoImport(file, onEvent) {
  const controller = new AbortController();
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(`${BASE}/entries/import/auto`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
    signal: controller.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  async function pump() {
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop();
        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find(l => l.startsWith('data: '));
          if (dataLine) {
            try {
              onEvent(JSON.parse(dataLine.slice(6)));
            } catch (_) { /* ignore malformed */ }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    }
  }

  return { pump, abort: () => controller.abort() };
}

export const checkDuplicates = (items) =>
  req('/entries/check-duplicates', { method: 'POST', body: JSON.stringify({ items }) });

export const searchMedia = (title, source = '') => {
  const qs = new URLSearchParams({ title, ...(source && { source }) }).toString();
  return req(`/search?${qs}`);
};

export const getStats = () => req('/stats');

export const deleteAllEntries = () => req('/entries', { method: 'DELETE' });
