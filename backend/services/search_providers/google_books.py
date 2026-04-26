from __future__ import annotations

import logging

import httpx

from schemas import ExploreItem, SearchResult
from .utils import settings, safe_year

logger = logging.getLogger(__name__)


async def search_google_books(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    params: dict = {"q": title, "maxResults": 5, "printType": "books"}
    api_key = settings.GOOGLE_BOOKS_API_KEY
    if api_key:
        params["key"] = api_key

    try:
        r = await client.get(
            "https://www.googleapis.com/books/v1/volumes", params=params
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("items", []):
            info = item.get("volumeInfo", {})
            images = info.get("imageLinks", {})
            raw_cover = (
                images.get("extraLarge")
                or images.get("large")
                or images.get("medium")
                or images.get("thumbnail")
                or images.get("smallThumbnail")
            )
            cover = raw_cover.replace("zoom=1", "zoom=3").replace("&edge=curl", "") if raw_cover else None
            pub_date = info.get("publishedDate", "")
            year = safe_year(pub_date)
            pages = info.get("pageCount")
            book_id = item.get("id")
            categories = info.get("categories") or []
            genres_str = ", ".join(categories[:5]) or None
            gb_rating = info.get("averageRating")
            ext_rating = round(float(gb_rating) * 2, 1) if gb_rating else None
            results.append(
                SearchResult(
                    title=info.get("title", ""),
                    medium="Book",
                    origin=None,
                    year=year,
                    cover_url=cover,
                    total=pages,
                    external_id=book_id,
                    source="google_books",
                    description=info.get("description") or None,
                    external_url=f"https://books.google.com/books?id={book_id}" if book_id else None,
                    genres=genres_str,
                    external_rating=ext_rating,
                )
            )
        return results
    except Exception as exc:
        logger.warning("Google Books search error: %s", exc)
        return []


async def _discover_google_books(
    client: httpx.AsyncClient, medium: str, top_genres: list[str], page: int = 1,
) -> list[ExploreItem]:
    """Google Books has no global popular feed; use consumed genres as subject hints."""
    if medium != "Book":
        return []
    queries = [f"subject:{g}" for g in top_genres[:2]] or ["subject:fiction"]
    out: list[ExploreItem] = []
    start_index = max(0, (page - 1) * 20)
    for q in queries:
        try:
            params = {"q": q, "orderBy": "relevance", "maxResults": 20,
                      "printType": "books", "startIndex": start_index}
            api_key = settings.GOOGLE_BOOKS_API_KEY
            if api_key:
                params["key"] = api_key
            r = await client.get("https://www.googleapis.com/books/v1/volumes", params=params)
            r.raise_for_status()
        except Exception as exc:
            logger.warning("Google Books discover error: %s", exc)
            continue
        for item in r.json().get("items", []):
            info = item.get("volumeInfo") or {}
            ext_id = item.get("id") or ""
            year = safe_year(info.get("publishedDate"))
            cover = (info.get("imageLinks") or {}).get("thumbnail")
            if cover and cover.startswith("http://"):
                cover = "https://" + cover[len("http://"):]
            avg = info.get("averageRating")
            out.append(ExploreItem(
                title=info.get("title") or "",
                medium="Book",
                year=year,
                cover_url=cover,
                external_id=ext_id,
                source="google_books",
                description=info.get("description") or None,
                external_url=info.get("infoLink") or info.get("previewLink"),
                genres=", ".join((info.get("categories") or [])[:3]) or None,
                external_rating=round(float(avg) * 2, 1) if avg else None,
            ))
    return out
