import { scrapeNovelUpdates } from './scrapers.js';

/**
 * Sites we scrape in-page (no API and/or Cloudflare-blocked server-side).
 * domain substring → injected scraper function.
 */
const DOM_SCRAPERS = {
  'novelupdates.com': scrapeNovelUpdates,
};

/**
 * Sites the backend can resolve from a URL via /search/from-url (have an API or
 * are reachable server-side). Mirrors backend url_scrapers DOMAIN_SCRAPERS minus
 * the DOM-scraped ones above.
 */
const API_DOMAINS = [
  'themoviedb.org', 'anilist.co', 'myanimelist.net', 'kitsu.io', 'kitsu.app',
  'mangadex.org', 'mangaupdates.com', 'baka-updates.com', 'igdb.com', 'rawg.io',
  'books.google.com', 'play.google.com', 'openlibrary.org',
  'comicvine.gamespot.com', 'vndb.org', 'jjwxc.net', 'qidian.com', 'imdb.com',
  'goodreads.com',
];

/**
 * Classify a tab URL.
 *   { kind: 'dom', scraper }  — inject `scraper` into the page
 *   { kind: 'api' }           — send the URL to /search/from-url
 *   { kind: 'unsupported' }   — not a recognised media page
 */
export function detectSite(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { kind: 'unsupported' };
  }

  for (const [domain, scraper] of Object.entries(DOM_SCRAPERS)) {
    if (host.includes(domain)) return { kind: 'dom', scraper };
  }
  if (API_DOMAINS.some((domain) => host.includes(domain))) return { kind: 'api' };
  return { kind: 'unsupported' };
}
