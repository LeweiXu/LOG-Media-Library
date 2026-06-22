// Shared search-source constants and helpers used by both the quick-add
// modal (AddEntryModal) and the full-page add panel (AddEntryPanel).

export const SEARCH_SOURCES = [
  { value: 'imdb',         label: 'IMDb' },
  { value: 'tmdb',         label: 'TMDB' },
  { value: 'anilist',      label: 'AniList' },
  { value: 'jikan',        label: 'MyAnimeList' },
  { value: 'kitsu',        label: 'Kitsu' },
  { value: 'novelupdates', label: 'NovelUpdates' },
  { value: 'mangadex',     label: 'MangaDex' },
  { value: 'mangaupdates', label: 'MangaUpdates' },
  { value: 'igdb',         label: 'IGDB' },
  { value: 'rawg',         label: 'RAWG' },
  { value: 'goodreads',    label: 'Goodreads' },
  { value: 'google_books', label: 'Google Books' },
  { value: 'open_library', label: 'Open Library' },
  { value: 'comicvine',    label: 'ComicVine' },
  { value: 'vndb',         label: 'VNDB' },
];

export const SOURCE_LABEL = {
  ...Object.fromEntries(SEARCH_SOURCES.map(s => [s.value, s.label])),
  // URL-only sources (not keyword-searchable, so not in SEARCH_SOURCES)
  jjwxc:  'JJWXC',
  qidian: 'Qidian',
};

// Curated sitewide default for which sources are *available* to search: roughly
// one provider per medium so the Add/Explore pickers don't offer overlapping
// sources that return the same titles (e.g. AniList vs MyAnimeList for anime).
// MyAnimeList (jikan) covers anime + manga, with MangaUpdates kept as a manga
// backup; IMDb covers film/TV (authoritative ratings + episode counts);
// NovelUpdates covers light/web novels; Goodreads covers books (richer metadata +
// reliable ratings than Google Books). Users edit the available set in
// Console → Search Sources.
export const DEFAULT_SOURCES = [
  'imdb',         // film, tv
  'jikan',        // anime, manga (MyAnimeList)
  'mangaupdates', // manga backup
  'novelupdates', // light novel, web novel
  'rawg',         // game
  'vndb',         // visual novel
  'goodreads',    // book
  'comicvine',    // comic
];

const LS_SOURCES_KEY = 'search_sources';
const LS_AVAILABLE_KEY = 'available_sources';

// Per-session source *selection* within a picker (which available sources to
// actually query). Empty = use all available sources.
export function loadSavedSources() {
  try {
    const raw = localStorage.getItem(LS_SOURCES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch (_) { /* ignore */ }
  return new Set();
}

export function saveSources(set) {
  localStorage.setItem(LS_SOURCES_KEY, JSON.stringify([...set]));
}

// Sitewide set of sources that are *available* to pick (Console setting).
// Defaults to the curated one-per-medium list above.
export function loadAvailableSources() {
  try {
    const raw = localStorage.getItem(LS_AVAILABLE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch (_) { /* ignore */ }
  return new Set(DEFAULT_SOURCES);
}

export function saveAvailableSources(set) {
  localStorage.setItem(LS_AVAILABLE_KEY, JSON.stringify([...set]));
}

// The SEARCH_SOURCES entries that are currently available, in canonical order.
export function availableSourceList() {
  const avail = loadAvailableSources();
  return SEARCH_SOURCES.filter(s => avail.has(s.value));
}

// Normalize a search/scrape result into the entry shape EntryForm expects.
export function resultToEntry(item) {
  return {
    title:           item.title           || '',
    medium:          item.medium          || '',
    origin:          item.origin          || '',
    status:          'current',
    year:            item.year            || '',
    rating:          '',
    progress:        '',
    total:           item.total           || '',
    cover_url:       item.cover_url       || item.cover || '',
    notes:           '',
    external_id:     item.id              || item.external_id    || '',
    source:          item.source          || '',
    external_url:    item.external_url    || '',
    genres:          item.genres          || '',
    external_rating: item.external_rating ?? '',
    custom_list:     '',
  };
}
