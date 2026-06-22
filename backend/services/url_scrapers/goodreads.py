"""Scrape a Goodreads book or series page into SearchResult(s).

A ``/book/show`` URL resolves to a single book; a ``/series`` URL resolves to a
**list** — one entry per canonical numbered installment (including decimals like
#0.5 / #4.5), with foreign-language editions, anthologies, omnibuses and box sets
excluded (their titles lack a single ``(Series, #N)`` position suffix).

Both reuse ``search_providers.goodreads`` so a book page is parsed identically
wherever it's reached. The series page already embeds per-book metadata in its
React props, which we keep as a fallback if an individual book-page fetch fails.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from html import unescape
from typing import Optional

from schemas import SearchResult
from services.search_providers.goodreads import (
    book_id_from_url,
    book_url,
    clean_title,
    fetch_book_detail,
    parse_book_html,
    series_position,
    upgrade_cover,
    _fetch_text,
    _rating_10,
    _strip_html,
)

logger = logging.getLogger(__name__)

# Cap how many book pages a single series resolves to (bounded concurrency too).
_SERIES_BOOK_CAP = 40
_SERIES_CONCURRENCY = 5


async def fetch(client, url: str):
    """URL scraper entrypoint. Returns a SearchResult, a list of them, or None."""
    if re.search(r"/series/", url):
        return await _fetch_series(client, url)
    if re.search(r"/book/show/", url):
        return await fetch_book_detail(url)
    return None


# ── Series ────────────────────────────────────────────────────────────────────

def _series_candidates(html: str) -> list[dict]:
    """Pull canonical numbered books out of the series page's React props.

    Each `data-react-props` blob is HTML-entity-encoded JSON; we walk it for book
    objects, keep only those whose title carries a single numeric `(Series, #N)`
    position, dedupe by URL, and order by position.
    """
    by_url: dict[str, dict] = {}

    def _walk(obj):
        if isinstance(obj, dict):
            if "bookUrl" in obj and "title" in obj:
                yield obj
            for v in obj.values():
                yield from _walk(v)
        elif isinstance(obj, list):
            for v in obj:
                yield from _walk(v)

    for raw in re.findall(r'data-react-props="([^"]+)"', html):
        try:
            data = json.loads(unescape(raw))
        except (ValueError, TypeError):
            continue
        for book in _walk(data):
            pos = series_position(book.get("title") or "")
            url = book.get("bookUrl")
            if pos is None or not url or url in by_url:
                continue
            book["_position"] = pos
            by_url[url] = book

    candidates = sorted(by_url.values(), key=lambda b: b["_position"])
    return candidates[:_SERIES_BOOK_CAP]


def _result_from_series_book(book: dict) -> Optional[SearchResult]:
    """Build a SearchResult from the series page's own book object (fallback when
    the per-book page fetch fails)."""
    url = book.get("bookUrl") or ""
    title = book.get("bookTitleBare") or clean_title(book.get("title") or "")
    if not title:
        return None
    year = None
    pub = book.get("publicationDate")
    if pub:
        ym = re.search(r"(\d{4})", str(pub))
        if ym:
            year = int(ym.group(1))
    return SearchResult(
        title=title,
        medium="Book",
        origin=None,
        year=year,
        cover_url=upgrade_cover(book.get("imageUrl")),
        total=book.get("numPages"),
        external_id=str(book.get("bookId") or book_id_from_url(url)),
        source="goodreads",
        description=_strip_html(book.get("description")),
        external_url=book_url(url),
        genres=None,
        external_rating=_rating_10(book.get("avgRating")),
    )


async def _fetch_series(client, url: str) -> list[SearchResult]:
    html = await _fetch_text(url)
    if not html:
        return []
    candidates = _series_candidates(html)
    if not candidates:
        return []

    sem = asyncio.Semaphore(_SERIES_CONCURRENCY)

    async def _resolve(book: dict) -> Optional[SearchResult]:
        full_url = book_url(book.get("bookUrl") or "")
        async with sem:
            detail = await fetch_book_detail(full_url) if full_url else None
        # Prefer the richer book-page parse; fall back to the series-page object.
        return detail or _result_from_series_book(book)

    resolved = await asyncio.gather(*(_resolve(b) for b in candidates))
    return [r for r in resolved if r]
