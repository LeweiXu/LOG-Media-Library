from __future__ import annotations

import logging

import httpx

from schemas import SearchResult
from .utils import settings, safe_year

logger = logging.getLogger(__name__)


async def search_rawg(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    """
    RAWG Video Games Database — free API key required.
    Register at: https://rawg.io/apidocs
    Add RAWG_API_KEY to backend/.env
    """
    api_key = settings.RAWG_API_KEY
    if not api_key:
        return []

    try:
        r = await client.get(
            "https://api.rawg.io/api/games",
            params={"key": api_key, "search": title, "page_size": 5},
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("results", []):
            cover = item.get("background_image")
            released = item.get("released") or ""
            year = safe_year(released[:4]) if released else None
            rawg_id = str(item.get("id", ""))
            slug = item.get("slug", rawg_id)
            rawg_genres = item.get("genres") or []
            genres_str = ", ".join(
                g["name"] for g in rawg_genres[:5] if g.get("name")
            ) or None
            rawg_rating = item.get("rating")
            ext_rating = round(float(rawg_rating) * 2, 1) if rawg_rating else None
            results.append(
                SearchResult(
                    title=item.get("name", ""),
                    medium="Game",
                    origin=None,
                    year=year,
                    cover_url=cover,
                    external_id=rawg_id,
                    source="rawg",
                    external_url=f"https://rawg.io/games/{slug}",
                    genres=genres_str,
                    external_rating=ext_rating,
                )
            )
        return results
    except Exception as exc:
        logger.warning("RAWG search error: %s", exc)
        return []
