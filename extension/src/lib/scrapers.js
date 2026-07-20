/**
 * DOM scrapers for no-API / Cloudflare-protected sites.
 *
 * Each scraper is injected into the active tab via chrome.scripting.executeScript,
 * so it MUST be fully self-contained — it runs in the page's world and cannot
 * close over any module-scope helpers or imports. It returns a plain,
 * serialisable object shaped for the frontend's entryToForm().
 *
 * The NovelUpdates selectors mirror backend/services/url_scrapers/novelupdates.py
 * so the two stay consistent.
 */

export function scrapeNovelUpdates() {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent.trim() : '';
  };

  const normaliseCover = (src) => {
    if (!src) return '';
    // The series page's <img src> is the real, resolvable cover URL (e.g.
    // /images/2025/07/Title.jpeg). Use it as-is — the old /imgmid/<file>
    // rewrite 404s for newer covers. Only fix up protocol/root-relative srcs.
    if (src.startsWith('//')) return 'https:' + src;
    if (src.startsWith('/')) return 'https://cdn.novelupdates.com' + src;
    return src;
  };

  const title = text('div.seriestitlenu');
  if (!title) return null;

  const slugMatch = location.pathname.match(/\/series\/([^/?#]+)/);
  const slug = slugMatch ? slugMatch[1] : '';

  // Find the cover by hunting for any <img> on the page that points at the
  // NovelUpdates image CDN — wherever it sits, whatever the format. Covers can
  // lazy-load, so check the common src-holding attributes, not just `src`.
  // The first `cdn.novelupdates.com/images` link wins.
  let cover_url = '';
  const COVER_ATTRS = ['src', 'data-src', 'data-cfsrc', 'data-lazy-src', 'data-original'];
  for (const el of document.querySelectorAll('img')) {
    for (const attr of COVER_ATTRS) {
      const candidate = normaliseCover(el.getAttribute(attr) || '');
      if (candidate.includes('cdn.novelupdates.com/images')) { cover_url = candidate; break; }
    }
    if (!cover_url) {
      const first = (el.getAttribute('srcset') || '').split(',')[0].trim().split(/\s+/)[0] || '';
      const candidate = normaliseCover(first);
      if (candidate.includes('cdn.novelupdates.com/images')) cover_url = candidate;
    }
    if (cover_url) break;
  }
  // Fall back to whatever the series-image container holds, even if off-CDN.
  if (!cover_url) {
    const img = document.querySelector('div.seriesimg img');
    if (img) {
      for (const attr of COVER_ATTRS) {
        const candidate = normaliseCover(img.getAttribute(attr) || '');
        if (candidate) { cover_url = candidate; break; }
      }
    }
  }

  const postId = document.querySelector('#mypostid');
  const external_id = (postId && postId.value) ? postId.value : slug;

  const typeText = text('#showtype');
  const medium = typeText.includes('Light Novel') ? 'Light Novel' : 'Web Novel';

  const lang = text('#showlang');
  const origin = ['Chinese', 'Korean', 'Japanese'].includes(lang) ? lang : '';

  let year = '';
  const yearMatch = text('#edityear').match(/(\d{4})/);
  if (yearMatch) year = yearMatch[1];

  let total = '';
  const totalMatch = text('#editstatus').match(/(\d+)\s*Chapter/);
  if (totalMatch) total = totalMatch[1];

  const genres = Array.from(document.querySelectorAll('#seriesgenre a.genre'))
    .map((a) => a.textContent.trim())
    .filter(Boolean)
    .join(', ');

  let external_rating = '';
  const ratingMatch = document.body.textContent.match(/(\d(?:\.\d+)?)\s*\/\s*5/);
  if (ratingMatch) external_rating = Math.round(parseFloat(ratingMatch[1]) * 2 * 10) / 10;

  // Full synopsis lives in #editdescription.
  const descEl = document.querySelector('#editdescription');
  const description = descEl ? descEl.textContent.replace(/\s+/g, ' ').trim() : '';

  return {
    title,
    medium,
    origin,
    year,
    cover_url,
    total,
    external_id,
    source: 'novelupdates',
    external_url: `https://www.novelupdates.com/series/${slug}/`,
    genres,
    external_rating,
    description: description || null,
    status: 'planned',
  };
}

/**
 * Read an anime, manga, or light novel directly from its MyAnimeList page.
 * The extension normally asks the backend first so Jikan remains the primary
 * source. This runs in the active tab only when that lookup fails.
 */
export function scrapeMyAnimeList() {
  const pageMatch = location.pathname.match(/^\/(anime|manga)\/(\d+)/);
  if (!pageMatch) return null;

  const [, kind, external_id] = pageMatch;
  const meta = (property) => {
    const el = document.querySelector(`meta[property="${property}"]`);
    return el ? (el.getAttribute('content') || '').trim() : '';
  };
  const labelledRow = (label) => Array.from(document.querySelectorAll('.spaceit_pad'))
    .find((row) => (row.querySelector('.dark_text')?.textContent || '').trim() === `${label}:`);
  const labelledText = (label) => {
    const row = labelledRow(label);
    if (!row) return '';
    const clone = row.cloneNode(true);
    clone.querySelector('.dark_text')?.remove();
    return clone.textContent.replace(/\s+/g, ' ').trim();
  };
  const numberFrom = (value) => {
    const match = String(value || '').replace(/,/g, '').match(/\d+/);
    return match ? match[0] : '';
  };

  const title = (document.querySelector('.title-english')?.textContent || '').trim()
    || (document.querySelector('.title-name')?.textContent || '').trim()
    || meta('og:title');
  if (!title) return null;

  const type = labelledText('Type');
  const medium = kind === 'anime'
    ? 'Anime'
    : /novel/i.test(type) ? 'Light Novel' : 'Manga';
  const totalLabel = medium === 'Anime' ? 'Episodes' : medium === 'Light Novel' ? 'Volumes' : 'Chapters';
  const dateText = labelledText(medium === 'Anime' ? 'Aired' : 'Published');
  const yearMatch = dateText.match(/\b(?:18|19|20)\d{2}\b/);

  const genreRow = labelledRow('Genres') || labelledRow('Genre');
  const genres = genreRow
    ? Array.from(genreRow.querySelectorAll('[itemprop="genre"]'))
      .map((el) => el.textContent.trim()).filter(Boolean).slice(0, 5).join(', ')
    : '';
  const scoreText = (document.querySelector('[itemprop="ratingValue"]')?.textContent || '').trim();
  const score = Number.parseFloat(scoreText);
  const description = (document.querySelector('[itemprop="description"]')?.textContent || meta('og:description'))
    .replace(/\s+/g, ' ').trim();

  return {
    title,
    medium,
    origin: 'Japanese',
    year: yearMatch ? yearMatch[0] : '',
    cover_url: meta('og:image'),
    total: numberFrom(labelledText(totalLabel)),
    external_id,
    source: 'jikan',
    external_url: `https://myanimelist.net/${kind}/${external_id}`,
    genres,
    external_rating: Number.isFinite(score) ? Math.round(score * 10) / 10 : null,
    description: description || null,
    status: 'planned',
  };
}
