"""Resolve a MyAnimeList URL into a SearchResult via the Jikan API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import safe_year


async def fetch(client, url: str) -> Optional[SearchResult]:
    # myanimelist.net/anime/1535  or  /manga/13/...  (trailing slug ignored)
    m = re.search(r"myanimelist\.net/(anime|manga)/(\d+)", url)
    if not m:
        return None
    kind, mal_id = m.group(1), m.group(2)

    try:
        r = await client.get(f"https://api.jikan.moe/v4/{kind}/{mal_id}")
        r.raise_for_status()
        d = r.json().get("data") or {}
    except Exception:
        return None
    if not d:
        return None

    titles = d.get("titles") or []
    title = next(
        (x["title"] for x in titles if x.get("type") == "English"), None
    ) or d.get("title")
    if not title:
        return None

    type_field = (d.get("type") or "").lower()
    if kind == "anime":
        medium = "Anime"
    elif "novel" in type_field:
        medium = "Light Novel"
    else:
        medium = "Manga"
    if medium == "Anime":
        total = d.get("episodes")
    elif medium == "Light Novel":
        total = d.get("volumes")
    else:
        total = d.get("chapters")

    images = d.get("images", {})
    jpg, webp = images.get("jpg", {}), images.get("webp", {})
    cover = (
        webp.get("large_image_url") or jpg.get("large_image_url")
        or webp.get("image_url") or jpg.get("image_url")
    )
    aired = d.get("aired") or d.get("published") or {}
    year = (aired.get("prop", {}).get("from", {}) or {}).get("year") or safe_year(
        (aired.get("from") or "")[:10] or None
    )
    score = d.get("score")
    return SearchResult(
        title=title,
        medium=medium,
        origin="Japanese",
        year=year,
        cover_url=cover,
        total=total,
        external_id=mal_id,
        source="jikan",
        description=d.get("synopsis") or None,
        external_url=f"https://myanimelist.net/{kind}/{mal_id}",
        genres=", ".join(g["name"] for g in (d.get("genres") or [])[:5] if g.get("name")) or None,
        external_rating=round(float(score), 1) if score else None,
    )
