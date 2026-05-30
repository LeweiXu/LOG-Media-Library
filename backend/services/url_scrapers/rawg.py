"""Resolve a RAWG game URL into a SearchResult via the RAWG API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import settings, safe_year


async def fetch(client, url: str) -> Optional[SearchResult]:
    m = re.search(r"rawg\.io/games/([^/?#]+)", url)
    if not m:
        return None
    slug = m.group(1)
    api_key = settings.RAWG_API_KEY
    if not api_key:
        return None

    try:
        r = await client.get(
            f"https://api.rawg.io/api/games/{slug}", params={"key": api_key}
        )
        r.raise_for_status()
        d = r.json()
    except Exception:
        return None
    if not d.get("name"):
        return None

    released = d.get("released") or ""
    rating = d.get("rating")  # RAWG ratings are 0–5
    return SearchResult(
        title=d.get("name", ""),
        medium="Game",
        origin=None,
        year=safe_year(released[:4]) if released else None,
        cover_url=d.get("background_image"),
        total=None,
        external_id=str(d.get("id", "")),
        source="rawg",
        description=d.get("description_raw") or None,
        external_url=f"https://rawg.io/games/{slug}",
        genres=", ".join(g["name"] for g in (d.get("genres") or [])[:5] if g.get("name")) or None,
        external_rating=round(float(rating) * 2, 1) if rating else None,
    )
