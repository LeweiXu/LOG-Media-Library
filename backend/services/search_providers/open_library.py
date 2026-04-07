from __future__ import annotations

import logging

import httpx

from schemas import SearchResult

logger = logging.getLogger(__name__)


async def search_open_library(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    """
    Open Library (Internet Archive) — no API key required.
    https://openlibrary.org/developers/api
    """
    try:
        r = await client.get(
            "https://openlibrary.org/search.json",
            params={"title": title, "limit": 5, "fields": "key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn"},
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("docs", []):
            cover_i = item.get("cover_i")
            cover = (
                f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg"
                if cover_i else None
            )
            ol_key = item.get("key", "")
            ol_id = ol_key.split("/")[-1] if ol_key else ""
            results.append(
                SearchResult(
                    title=item.get("title", ""),
                    medium="Book",
                    origin=None,
                    year=item.get("first_publish_year"),
                    cover_url=cover,
                    total=item.get("number_of_pages_median"),
                    external_id=ol_id,
                    source="open_library",
                    external_url=f"https://openlibrary.org{ol_key}" if ol_key else None,
                )
            )
        return results
    except Exception as exc:
        logger.warning("Open Library search error: %s", exc)
        return []
