"""Resolve an IGDB game URL into a SearchResult via the IGDB API."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import settings
from services.search_providers.igdb import _get_igdb_token


async def fetch(client, url: str) -> Optional[SearchResult]:
    m = re.search(r"igdb\.com/games/([^/?#]+)", url)
    if not m:
        return None
    slug = m.group(1)
    client_id = settings.IGDB_CLIENT_ID
    if not client_id:
        return None
    token = await _get_igdb_token(client)
    if not token:
        return None

    try:
        r = await client.post(
            "https://api.igdb.com/v4/games",
            headers={"Client-ID": client_id, "Authorization": f"Bearer {token}"},
            content=(
                f'where slug = "{slug}"; '
                f"fields name,first_release_date,cover.image_id,summary,url,genres.name,rating; "
                f"limit 1;"
            ),
        )
        r.raise_for_status()
        arr = r.json()
    except Exception:
        return None
    if not arr:
        return None
    item = arr[0]

    cover = item.get("cover") or {}
    image_id = cover.get("image_id")
    cover_url = (
        f"https://images.igdb.com/igdb/image/upload/t_cover_big_2x/{image_id}.jpg"
        if image_id else None
    )
    ts = item.get("first_release_date")
    rating = item.get("rating")
    return SearchResult(
        title=item.get("name", ""),
        medium="Game",
        origin=None,
        year=datetime.fromtimestamp(ts).year if ts else None,
        cover_url=cover_url,
        total=None,
        external_id=str(item.get("id", "")),
        source="igdb",
        description=item.get("summary") or None,
        external_url=item.get("url") or f"https://www.igdb.com/games/{slug}",
        genres=", ".join(g["name"] for g in (item.get("genres") or [])[:5] if g.get("name")) or None,
        external_rating=round(rating / 10, 1) if rating else None,
    )
