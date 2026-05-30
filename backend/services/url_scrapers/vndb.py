"""Resolve a VNDB visual-novel URL into a SearchResult via the VNDB API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import safe_year
from services.search_providers.vndb import _LANG_TO_ORIGIN


async def fetch(client, url: str) -> Optional[SearchResult]:
    m = re.search(r"vndb\.org/(v\d+)", url)
    if not m:
        return None
    vid = m.group(1)

    try:
        r = await client.post(
            "https://api.vndb.org/kana/vn",
            json={
                "filters": ["id", "=", vid],
                "fields": "id,title,released,rating,image.url,olang,tags.name,description",
                "results": 1,
            },
        )
        r.raise_for_status()
        items = r.json().get("results") or []
    except Exception:
        return None
    if not items:
        return None
    item = items[0]

    title = item.get("title")
    if not title:
        return None

    olang = (item.get("olang") or "").lower()
    raw_rating = item.get("rating")
    try:
        ext_rating = round(float(raw_rating) / 10, 1) if raw_rating else None
    except (ValueError, TypeError):
        ext_rating = None
    tags = item.get("tags") or []
    return SearchResult(
        title=title,
        medium="Visual Novel",
        origin=_LANG_TO_ORIGIN.get(olang, "Other") if olang else None,
        year=safe_year(item.get("released")),
        cover_url=(item.get("image") or {}).get("url") or None,
        external_id=vid,
        source="vndb",
        description=item.get("description") or None,
        external_url=f"https://vndb.org/{vid}",
        genres=", ".join(t["name"] for t in tags if t.get("name"))[:500] or None,
        external_rating=ext_rating,
    )
