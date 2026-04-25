from __future__ import annotations

import logging

import httpx

from schemas import SearchResult
from .utils import settings

logger = logging.getLogger(__name__)


async def search_comicvine(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    """
    ComicVine — free API key required.
    Register at: https://comicvine.gamespot.com/api/
    Add COMICVINE_API_KEY to backend/.env
    """
    api_key = settings.COMICVINE_API_KEY
    if not api_key:
        return []

    try:
        r = await client.get(
            "https://comicvine.gamespot.com/api/search/",
            params={
                "api_key": api_key,
                "format": "json",
                "query": title,
                "resources": "volume",
                "limit": 5,
                "field_list": "id,name,start_year,image,description,site_detail_url,count_of_issues",
            },
            headers={"User-Agent": "LOG-MediaTracker/1.0"},
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("results", []):
            img = item.get("image", {})
            cover = (
                img.get("original_url")
                or img.get("screen_large_url")
                or img.get("medium_url")
            )
            year = None
            try:
                raw_year = item.get("start_year")
                year = int(raw_year) if raw_year else None
            except (ValueError, TypeError):
                pass
            cv_id = str(item.get("id", ""))
            results.append(
                SearchResult(
                    title=item.get("name", ""),
                    medium="Comic",
                    origin="Western",
                    year=year,
                    cover_url=cover,
                    total=item.get("count_of_issues"),
                    external_id=cv_id,
                    source="comicvine",
                    description=(item.get("description") or "")[:200] or None,
                    external_url=item.get("site_detail_url"),
                )
            )
        return results
    except Exception as exc:
        logger.warning("ComicVine search error: %s", exc)
        return []
