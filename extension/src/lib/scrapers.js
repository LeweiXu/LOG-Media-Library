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

  // Find the cover by hunting for any <img> that points at the NovelUpdates
  // image CDN, wherever it sits in the DOM. Don't care about container, format,
  // or layout — the first cdn.novelupdates.com/images link is the cover.
  let cover_url = '';
  for (const el of document.querySelectorAll('img')) {
    const raw = el.getAttribute('src') || el.getAttribute('data-src') || '';
    const candidate = normaliseCover(raw);
    if (candidate.includes('cdn.novelupdates.com/images')) {
      cover_url = candidate;
      break;
    }
  }
  // Fall back to the conventional series-image container if nothing matched.
  if (!cover_url) {
    const img = document.querySelector('div.seriesimg img');
    if (img) cover_url = normaliseCover(img.getAttribute('src') || img.getAttribute('data-src') || '');
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
    status: 'planned',
  };
}
