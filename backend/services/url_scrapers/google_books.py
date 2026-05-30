"""Resolve a Google Books URL into a SearchResult via the Books API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import settings, safe_year


def _volume_id(url: str) -> Optional[str]:
    # books.google.com/books?id=XXXX  or  google.com/books/edition/_/XXXX
    m = re.search(r"[?&]id=([A-Za-z0-9_-]+)", url) or re.search(
        r"/books/edition/[^/]+/([A-Za-z0-9_-]+)", url
    )
    return m.group(1) if m else None


async def fetch(client, url: str) -> Optional[SearchResult]:
    book_id = _volume_id(url)
    if not book_id:
        return None

    params = {}
    if settings.GOOGLE_BOOKS_API_KEY:
        params["key"] = settings.GOOGLE_BOOKS_API_KEY
    try:
        r = await client.get(
            f"https://www.googleapis.com/books/v1/volumes/{book_id}", params=params
        )
        r.raise_for_status()
        info = r.json().get("volumeInfo", {})
    except Exception:
        return None
    if not info.get("title"):
        return None

    images = info.get("imageLinks", {})
    raw_cover = (
        images.get("extraLarge") or images.get("large") or images.get("medium")
        or images.get("thumbnail") or images.get("smallThumbnail")
    )
    cover = raw_cover.replace("zoom=1", "zoom=3").replace("&edge=curl", "") if raw_cover else None
    gb_rating = info.get("averageRating")
    return SearchResult(
        title=info.get("title", ""),
        medium="Book",
        origin=None,
        year=safe_year(info.get("publishedDate", "")),
        cover_url=cover,
        total=info.get("pageCount"),
        external_id=book_id,
        source="google_books",
        description=info.get("description") or None,
        external_url=f"https://books.google.com/books?id={book_id}",
        genres=", ".join((info.get("categories") or [])[:5]) or None,
        external_rating=round(float(gb_rating) * 2, 1) if gb_rating else None,
    )
