// Shared search-source constants and helpers used by both the quick-add
// modal (AddEntryModal) and the full-page add panel (AddEntryPanel).

export const SEARCH_SOURCES = [
  { value: 'tmdb',         label: 'TMDB' },
  { value: 'anilist',      label: 'AniList' },
  { value: 'jikan',        label: 'MyAnimeList' },
  { value: 'kitsu',        label: 'Kitsu' },
  { value: 'novelupdates', label: 'NovelUpdates' },
  { value: 'mangadex',     label: 'MangaDex' },
  { value: 'mangaupdates', label: 'MangaUpdates' },
  { value: 'igdb',         label: 'IGDB' },
  { value: 'rawg',         label: 'RAWG' },
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
  imdb:   'IMDb',
};

const LS_SOURCES_KEY = 'search_sources';

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
