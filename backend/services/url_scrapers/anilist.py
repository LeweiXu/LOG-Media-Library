"""Resolve an AniList anime/manga URL into a SearchResult via the GraphQL API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import country_to_origin
from services.search_providers.anilist import _ANILIST_FORMAT_TO_MEDIUM

_QUERY = """
query ($id: Int) {
  Media(id: $id) {
    id title { romaji english native }
    format episodes chapters volumes
    startDate { year }
    coverImage { extraLarge large medium }
    countryOfOrigin description(asHtml: false) genres averageScore
  }
}
"""


async def fetch(client, url: str) -> Optional[SearchResult]:
    m = re.search(r"anilist\.co/(anime|manga)/(\d+)", url)
    if not m:
        return None
    kind, aid = m.group(1), int(m.group(2))

    try:
        r = await client.post(
            "https://graphql.anilist.co",
            json={"query": _QUERY, "variables": {"id": aid}},
        )
        r.raise_for_status()
        d = r.json().get("data", {}).get("Media")
    except Exception:
        return None
    if not d:
        return None

    t = d.get("title", {})
    title = t.get("english") or t.get("romaji") or t.get("native")
    if not title:
        return None

    medium = _ANILIST_FORMAT_TO_MEDIUM.get(
        d.get("format", ""), "Anime" if kind == "anime" else "Manga"
    )
    if medium == "Anime":
        total = d.get("episodes")
    elif medium == "Light Novel":
        total = d.get("volumes")
    else:
        total = d.get("chapters")

    cover_img = d.get("coverImage", {})
    avg = d.get("averageScore")
    return SearchResult(
        title=title,
        medium=medium,
        origin=country_to_origin(d.get("countryOfOrigin")),
        year=(d.get("startDate") or {}).get("year"),
        cover_url=cover_img.get("extraLarge") or cover_img.get("large") or cover_img.get("medium"),
        total=total,
        external_id=str(d.get("id")),
        source="anilist",
        description=d.get("description") or None,
        external_url=f"https://anilist.co/{kind}/{d.get('id')}",
        genres=", ".join((d.get("genres") or [])[:5]) or None,
        external_rating=round(avg / 10, 1) if avg else None,
    )
