import { BASE } from './api.jsx';

export const STATUSES = ['current', 'planned', 'completed', 'on_hold', 'dropped'];

export const MEDIUMS = [
  'Film', 'TV Show', 'Anime', 'Book', 'Manga',
  'Light Novel', 'Web Novel', 'Comic', 'Game', 'Visual Novel',
];

export const RATING_OPTIONS = Array.from({ length: 11 }, (_, i) => i);

export const ORIGINS = ['Japanese', 'Korean', 'Chinese', 'Western', 'Other'];

export const STATUS_LABELS = {
  current:   'Current',
  planned:   'Planned',
  completed: 'Completed',
  on_hold:   'On Hold',
  dropped:   'Dropped',
};

export const statusLabel   = (s) => STATUS_LABELS[s] ?? s;
export const badgeClass    = (s) => `badge badge-${s}`;

/**
 * Generic fallback cover, used when a cover image fails to load (e.g. the many
 * NovelUpdates covers that 404/403 behind Cloudflare and can't be hotlinked).
 * It's an inline SVG data URI — no network request, no image hosted by us, and
 * nothing to rot. Transparent background so the cover container's themed
 * colour shows through and it reads correctly in both dark and light themes.
 */
const _COVER_PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 132" preserveAspectRatio="xMidYMid meet">' +
  '<g fill="none" stroke="#7a7d82" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' +
  '<rect x="24" y="42" width="44" height="40"/>' +
  '<circle cx="37" cy="55" r="4.5"/>' +
  '<path d="M26 78 L44 62 L54 70 L66 56 L66 80 Z" fill="#7a7d82" fill-opacity="0.18"/>' +
  '</g>' +
  '<text x="46" y="100" font-family="monospace" font-size="9" letter-spacing="1.5" ' +
  'text-anchor="middle" fill="#7a7d82">NO COVER</text></svg>';

export const COVER_PLACEHOLDER =
  'data:image/svg+xml,' + encodeURIComponent(_COVER_PLACEHOLDER_SVG);

/** URL of the server-side cached copy of a cover (uploaded by the extension). */
export const cachedCoverUrl = (coverUrl) =>
  coverUrl ? `${BASE}/covers/full?${new URLSearchParams({ url: coverUrl })}` : '';

/**
 * Shared <img onError> handler with a 3-stage fallback:
 *   original cover_url → server-side cached copy → generic placeholder.
 * The original (e.g. a Cloudflare-gated NovelUpdates cover) often 403s in the
 * browser; if the extension has cached it we serve that, otherwise the inline
 * "NO COVER" placeholder. Cached is fallback-only — never prioritised — so
 * working covers still load straight from source at full speed.
 */
export function onCoverError(e) {
  const img = e.currentTarget;
  const stage = img.dataset.coverStage;
  if (!stage) {
    // Original failed. At this point img.src is the resolved original URL.
    const cached = cachedCoverUrl(img.src);
    if (cached) {
      img.dataset.coverStage = 'cached';
      img.src = cached;
      return;
    }
    img.dataset.coverStage = 'placeholder';
    img.src = COVER_PLACEHOLDER;
    return;
  }
  if (stage === 'cached') {
    // No cached copy either → generic placeholder.
    img.dataset.coverStage = 'placeholder';
    img.src = COVER_PLACEHOLDER;
  }
  // stage === 'placeholder': data URI can't fail; nothing more to do.
}

export const logDotClass = (status) => ({
  current:   'log-dot blue',
  planned:   'log-dot purple',
  completed: 'log-dot',
  on_hold:   'log-dot amber',
  dropped:   'log-dot red',
}[status] ?? 'log-dot');

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 60)  return `${mins}m ago`;
  const hrs  = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)   return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5)  return `${weeks}w ago`;
  return fmtDate(iso);
}

export function progressPercent(entry) {
  if (!entry) return 0;
  const { progress, total } = entry;
  if (!total) return 0;
  return Math.min(100, Math.round((progress / total) * 100));
}

export function progressLabel(entry) {
  if (!entry) return '—';
  const { progress, total, medium } = entry;
  if (!progress && !total) return '—';
  const m = medium?.toLowerCase() ?? '';
  const unit = (m === 'book' || m === 'light novel') ? 'vol.'
             : (m === 'manga' || m === 'web novel' || m === 'comic' || m === 'visual novel') ? 'ch.'
             : m === 'game' ? 'hr.'
             : 'ep.';
  if (total) return `${progress ?? '?'} / ${total} ${unit}`;
  return `${progress} ${unit}`;
}

const _SOURCE_DOMAINS = {
  'themoviedb.org':         'tmdb',
  'anilist.co':             'anilist',
  'myanimelist.net':        'jikan',
  'kitsu.io':               'kitsu',
  'kitsu.app':              'kitsu',
  'novelupdates.com':       'novelupdates',
  'mangadex.org':           'mangadex',
  'igdb.com':               'igdb',
  'rawg.io':                'rawg',
  'books.google.com':       'google_books',
  'play.google.com':        'google_books',
  'openlibrary.org':        'open_library',
  'comicvine.gamespot.com': 'comicvine',
  'mangaupdates.com':       'mangaupdates',
  'baka-updates.com':       'mangaupdates',
  'vndb.org':               'vndb',
  'jjwxc.net':              'jjwxc',
  'qidian.com':             'qidian',
  'imdb.com':               'imdb',
};

/** Sources whose pages can be imported by pasting a URL (resolved backend-side). */
export const URL_SCRAPE_SOURCES = new Set([
  'novelupdates', 'jjwxc', 'qidian', 'imdb',
  'tmdb', 'anilist', 'jikan', 'kitsu', 'mangadex', 'mangaupdates',
  'igdb', 'rawg', 'google_books', 'open_library', 'comicvine', 'vndb',
]);

/** True if the string looks like a pasteable http(s) URL rather than a title. */
export function isUrl(s) {
  return /^https?:\/\//i.test((s || '').trim());
}

/** Infer the source name from a URL, or return '' if unrecognised. */
export function inferSourceFromUrl(url) {
  if (!url) return '';
  const lower = url.toLowerCase();
  for (const [domain, source] of Object.entries(_SOURCE_DOMAINS)) {
    if (lower.includes(domain)) return source;
  }
  return '';
}

/** Build a link to the entry's page on its external source database */
export function externalUrl(source, external_id, medium) {
  if (!source || !external_id) return null;
  switch (source) {
    case 'anilist': {
      const type = (medium === 'Anime') ? 'anime' : 'manga';
      return `https://anilist.co/${type}/${external_id}`;
    }
    case 'tmdb': {
      // Entries created from TV searches have medium "TV Show"
      const type = (medium === 'TV Show') ? 'tv' : 'movie';
      return `https://www.themoviedb.org/${type}/${external_id}`;
    }
    case 'google_books':
      return `https://books.google.com/books?id=${external_id}`;
    default:
      return null;
  }
}

/** Normalise the varied shapes the backend might return for a list response */
export function extractItems(data) {
  if (Array.isArray(data)) return data;
  return data?.items ?? data?.entries ?? data?.results ?? [];
}
