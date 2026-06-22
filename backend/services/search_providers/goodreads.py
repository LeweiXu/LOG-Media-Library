"""Goodreads provider — keyword search, single-book detail, and Explore discovery.

Goodreads has no public API. Two of its surfaces are reachable server-side with a
browser-impersonated request (``curl_cffi``): the ``/book/show`` and ``/series``
pages, and the ``/book/auto_complete`` JSON endpoint. The ``/search`` HTML page,
by contrast, sits behind an **AWS WAF** JS challenge we can't solve server-side —
so keyword search goes through ``auto_complete`` instead of scraping ``/search``.

Ratings are normalised from Goodreads' 0–5 scale to this app's 0–10
``external_rating`` (×2), mirroring the NovelUpdates provider. ``medium`` is
always ``Book``; ``origin`` is left unset (Goodreads exposes no clean signal).

``fetch_book_detail`` is shared with ``url_scrapers/goodreads.py`` so the
add-by-URL / series paths and search enrichment parse a book page the same way.
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from schemas import SearchResult

logger = logging.getLogger(__name__)

GOODREADS = "https://www.goodreads.com"

# "Title (Series Name, #N)" / "(Series, #4.5)" trailing suffix → strip for a
# clean title; or capture the single numeric position (used by the series scraper
# to keep only canonical numbered installments and reject foreign editions /
# omnibuses, whose titles either lack the suffix or carry a range like "#1-2").
_SERIES_SUFFIX = re.compile(r"\s*\([^()]*,\s*#[0-9]+(?:\.[0-9]+)?\)\s*$")
_SERIES_POSITION = re.compile(r"\(\s*[^()]*,\s*#\s*([0-9]+(?:\.[0-9]+)?)\s*\)\s*$")
# Goodreads image URLs carry a size token (._SX75_ / ._SY180_ / ._SX50_) before
# the extension; dropping it yields the full-resolution cover.
_COVER_SIZE = re.compile(r"\._S[XY]\d+_(?=\.)")


def clean_title(title: str) -> str:
    return _SERIES_SUFFIX.sub("", title or "").strip()


def series_position(title: str) -> Optional[float]:
    m = _SERIES_POSITION.search(title or "")
    if not m:
        return None
    try:
        return float(m.group(1))
    except (TypeError, ValueError):
        return None


def upgrade_cover(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    return _COVER_SIZE.sub("", url)


def book_id_from_url(url: str) -> str:
    m = re.search(r"/book/show/(\d+)", url or "")
    return m.group(1) if m else ""


def book_url(path_or_url: str) -> Optional[str]:
    if not path_or_url:
        return None
    if path_or_url.startswith("/"):
        return GOODREADS + path_or_url
    return path_or_url


def _rating_10(value) -> Optional[float]:
    try:
        return round(float(value) * 2, 1)
    except (TypeError, ValueError):
        return None


def _year_from_ms(ms) -> Optional[int]:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).year
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _strip_html(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    cleaned = html.unescape(re.sub(r"<[^>]+>", "", text)).strip()
    return cleaned or None


async def _fetch_text(url: str, *, params: Optional[dict] = None, timeout: int = 20) -> Optional[str]:
    """GET ``url`` impersonating Chrome; ``None`` on failure or a WAF challenge.

    ``/search`` (and some listing pages) return an AWS WAF interstitial (HTTP 202
    with a ``gokuProps`` body); detect and degrade rather than parse garbage.
    """
    from curl_cffi import requests as cffi_requests

    def _do_get() -> Optional[str]:
        try:
            r = cffi_requests.get(url, params=params, timeout=timeout, impersonate="chrome")
            if r.status_code == 202 or "gokuProps" in r.text[:2000]:
                logger.warning("Goodreads WAF challenge on %s — skipping.", url)
                return None
            r.raise_for_status()
            return r.text
        except Exception as exc:
            logger.warning("Goodreads fetch error for %s: %s", url, exc)
            return None

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _do_get)


# ── Keyword search (auto_complete JSON) ───────────────────────────────────────

async def search_goodreads(
    client,       # httpx.AsyncClient — unused; kept for provider-API consistency
    title: str,
    limit: int = 10,
) -> list[SearchResult]:
    """Search books via Goodreads' WAF-free ``auto_complete`` JSON endpoint."""
    text = await _fetch_text(
        f"{GOODREADS}/book/auto_complete", params={"format": "json", "q": title}
    )
    if not text:
        return []
    try:
        items = json.loads(text)
    except (ValueError, TypeError):
        return []
    if not isinstance(items, list):
        return []

    results: list[SearchResult] = []
    for it in items[: max(1, min(limit, 20))]:
        if not isinstance(it, dict):
            continue
        url = it.get("bookUrl") or ""
        title_bare = it.get("bookTitleBare") or clean_title(it.get("title") or "")
        if not title_bare:
            continue
        desc = it.get("description")
        if isinstance(desc, dict):
            desc = desc.get("html")
        bid = it.get("bookId") or book_id_from_url(url)
        results.append(
            SearchResult(
                title=title_bare,
                medium="Book",
                origin=None,
                year=None,  # auto_complete carries no publication year
                cover_url=upgrade_cover(it.get("imageUrl")),
                total=it.get("numPages"),
                external_id=str(bid) if bid else "",
                source="goodreads",
                description=_strip_html(desc),
                external_url=book_url(url),
                genres=None,
                external_rating=_rating_10(it.get("avgRating")),
            )
        )
    return results


# ── Single-book detail (shared with the URL / series scraper) ─────────────────

def _find_book_object(apollo: dict, book_id: str) -> Optional[dict]:
    """Pick the page's primary Book from the Apollo cache (match by legacyId)."""
    fallback = None
    for v in apollo.values():
        if isinstance(v, dict) and v.get("__typename") == "Book":
            if book_id and str(v.get("legacyId")) == str(book_id):
                return v
            if fallback is None:
                fallback = v
    return fallback


def parse_book_html(html: str, url: str) -> Optional[SearchResult]:
    """Parse a Goodreads ``/book/show`` page into a SearchResult.

    Primary source is the ``__NEXT_DATA__`` Apollo cache (clean title, genres,
    description, page count, publication year); the ``ld+json`` block backfills
    cover and rating.
    """
    bid = book_id_from_url(url)

    apollo: dict = {}
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S
    )
    if m:
        try:
            data = json.loads(m.group(1))
            apollo = (data.get("props", {}).get("pageProps", {}).get("apolloState", {})) or {}
        except (ValueError, TypeError):
            apollo = {}

    ld: dict = {}
    lm = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    if lm:
        try:
            ld = json.loads(lm.group(1))
        except (ValueError, TypeError):
            ld = {}
        if not isinstance(ld, dict):
            ld = {}

    title = None
    year = None
    total = None
    cover = None
    description = None
    genres: list[str] = []
    external_url = url
    external_id = bid

    book = _find_book_object(apollo, bid)
    if book:
        title = book.get("title")
        external_url = book.get("webUrl") or url
        external_id = str(book.get("legacyId") or bid) or bid
        cover = book.get("imageUrl")
        if isinstance(book.get("description"), str):
            description = book["description"]
        details = book.get("details")
        if isinstance(details, dict):
            total = details.get("numPages")
            year = _year_from_ms(details.get("publicationTime"))
        for bg in book.get("bookGenres") or []:
            name = (bg.get("genre") or {}).get("name") if isinstance(bg, dict) else None
            if name:
                genres.append(name)

    # ld+json fallbacks.
    if not title:
        title = ld.get("name")
    title = clean_title(title or "")
    if not title:
        return None
    if total is None:
        total = ld.get("numberOfPages")
    if not cover:
        cover = ld.get("image")
    rating = None
    agg = ld.get("aggregateRating")
    if isinstance(agg, dict):
        rating = _rating_10(agg.get("ratingValue"))

    if isinstance(total, str):
        m_pages = re.search(r"\d+", total)
        total = int(m_pages.group()) if m_pages else None

    return SearchResult(
        title=title,
        medium="Book",
        origin=None,
        year=year,
        cover_url=upgrade_cover(cover),
        total=total,
        external_id=external_id or bid,
        source="goodreads",
        description=(description[:800] if description else None),
        external_url=external_url,
        genres=", ".join(dict.fromkeys(genres)) or None,
        external_rating=rating,
    )


async def fetch_book_detail(url: str) -> Optional[SearchResult]:
    html = await _fetch_text(url)
    if not html:
        return None
    return parse_book_html(html, url)


# ── Explore discovery (genre shelves) ─────────────────────────────────────────

# Map a LOG/Goodreads genre name to a Goodreads shelf slug.
def _genre_slug(top_genres: Optional[list[str]]) -> str:
    for g in (top_genres or []):
        slug = re.sub(r"[^a-z0-9]+", "-", (g or "").lower()).strip("-")
        if slug:
            return slug
    return "fiction"


def _parse_shelf(html: str) -> list:
    from bs4 import BeautifulSoup
    from schemas import ExploreItem

    soup = BeautifulSoup(html, "lxml")
    out = []
    for row in soup.select("div.elementList"):
        link = row.select_one("a.bookTitle") or row.select_one("a.leftAlignedImage")
        if not link:
            continue
        href = link.get("href") or ""
        title = clean_title(link.get_text(strip=True) or link.get("title") or "")
        if not title or "/book/show/" not in href:
            continue

        img = row.select_one("img")
        cover = upgrade_cover(img.get("src")) if img else None

        year = None
        rating = None
        grey = row.select_one(".greyText.smallText") or row.select_one(".greyText")
        if grey:
            text = grey.get_text(" ", strip=True)
            rm = re.search(r"avg rating\s*([\d.]+)", text)
            if rm:
                rating = _rating_10(rm.group(1))
            ym = re.search(r"published\s*(\d{4})", text)
            if ym:
                year = int(ym.group(1))

        out.append(
            ExploreItem(
                title=title,
                medium="Book",
                origin=None,
                year=year,
                cover_url=cover,
                total=None,
                external_id=book_id_from_url(href),
                source="goodreads",
                description=None,
                external_url=book_url(href),
                genres=None,
                external_rating=rating,
            )
        )
    return out


async def _enrich_descriptions(items, cap: int = 18) -> None:
    """Fill in synopses for shelf items (the shelf page carries none).

    Goodreads shelf rows have no description. The ``auto_complete`` JSON only
    carries a short, often-missing blurb, so we scrape the book's own page
    instead (``fetch_book_detail`` parses the full ``__NEXT_DATA__`` synopsis) —
    the same path the add-by-URL flow uses. Bounded + concurrent + best-effort;
    items past ``cap`` (or that fail / are WAF-blocked) keep no description.
    """
    targets = [it for it in items if not it.description and it.external_url][:cap]
    if not targets:
        return
    sem = asyncio.Semaphore(6)

    async def _fill(item):
        async with sem:
            detail = await fetch_book_detail(item.external_url)
        if detail and detail.description:
            item.description = detail.description

    await asyncio.gather(*(_fill(it) for it in targets), return_exceptions=True)


async def _discover_goodreads(client, medium: str, top_genres=None, page: int = 1):
    """Scrape a Goodreads genre shelf as Book Explore candidates.

    Called with ``top_genres`` (like ``_discover_google_books``) so the shelf
    follows the user's most-consumed genre; falls back to the general fiction
    shelf. Book medium only.
    """
    if medium != "Book":
        return []
    slug = _genre_slug(top_genres)
    html = await _fetch_text(f"{GOODREADS}/shelf/show/{slug}", params={"page": page})
    if not html:
        return []
    try:
        items = _parse_shelf(html)
    except Exception as exc:  # best-effort, like every discovery provider
        logger.warning("Goodreads shelf parse error (%s): %s", slug, exc)
        return []
    await _enrich_descriptions(items)
    return items
