"""Resolve a ComicVine volume URL into a SearchResult via the ComicVine API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import settings


async def fetch(client, url: str) -> Optional[SearchResult]:
    # comicvine.gamespot.com/<slug>/4050-<id>/
    m = re.search(r"/4050-(\d+)", url)
    if not m:
        return None
    vol_id = m.group(1)
    api_key = settings.COMICVINE_API_KEY
    if not api_key:
        return None

    try:
        r = await client.get(
            f"https://comicvine.gamespot.com/api/volume/4050-{vol_id}/",
            params={
                "api_key": api_key,
                "format": "json",
                "field_list": "id,name,start_year,image,description,site_detail_url,count_of_issues",
            },
            headers={"User-Agent": "LOG-MediaTracker/1.0"},
        )
        r.raise_for_status()
        res = r.json().get("results") or {}
    except Exception:
        return None
    if not res.get("name"):
        return None

    img = res.get("image", {})
    try:
        year = int(res["start_year"]) if res.get("start_year") else None
    except (ValueError, TypeError):
        year = None

    return SearchResult(
        title=res.get("name", ""),
        medium="Comic",
        origin="Western",
        year=year,
        cover_url=img.get("original_url") or img.get("screen_large_url") or img.get("medium_url"),
        total=res.get("count_of_issues"),
        external_id=str(res.get("id", "")),
        source="comicvine",
        description=res.get("description") or None,
        external_url=res.get("site_detail_url") or url,
    )
