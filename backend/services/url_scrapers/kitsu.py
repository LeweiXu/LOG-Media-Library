"""Resolve a Kitsu anime/manga URL into a SearchResult via the Kitsu API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import safe_year

_HEADERS = {"Accept": "application/vnd.api+json"}


async def fetch(client, url: str) -> Optional[SearchResult]:
    # kitsu.app/anime/<slug> or kitsu.io/manga/<slug> (slug or numeric id)
    m = re.search(r"kitsu\.(?:io|app)/(anime|manga)/([^/?#]+)", url)
    if not m:
        return None
    kind, slug = m.group(1), m.group(2)
    endpoint = f"https://kitsu.app/api/edge/{kind}"

    try:
        if slug.isdigit():
            r = await client.get(f"{endpoint}/{slug}", headers=_HEADERS)
            r.raise_for_status()
            item = r.json().get("data")
        else:
            r = await client.get(endpoint, params={"filter[slug]": slug}, headers=_HEADERS)
            r.raise_for_status()
            data = r.json().get("data") or []
            item = data[0] if data else None
    except Exception:
        return None
    if not item:
        return None

    attrs = item.get("attributes", {})
    titles = attrs.get("titles") or {}
    title = titles.get("en") or titles.get("en_jp") or attrs.get("canonicalTitle")
    if not title:
        return None

    poster = attrs.get("posterImage") or {}
    started = attrs.get("startDate") or ""
    subtype = (attrs.get("subtype") or "").lower()
    medium = "Anime" if kind == "anime" else "Manga"
    if kind == "manga" and subtype == "novel":
        medium = "Light Novel"
    elif kind == "manga" and subtype == "manhwa":
        medium = "Comic"
    ar = attrs.get("averageRating")
    try:
        ext_rating = round(float(ar) / 10, 1) if ar else None
    except (ValueError, TypeError):
        ext_rating = None

    return SearchResult(
        title=title,
        medium=medium,
        origin=None,
        year=safe_year(started[:4]) if started else None,
        cover_url=poster.get("original") or poster.get("large") or poster.get("medium"),
        total=attrs.get("episodeCount") or attrs.get("chapterCount"),
        external_id=str(item.get("id")),
        source="kitsu",
        description=attrs.get("synopsis") or None,
        external_url=f"https://kitsu.app/{kind}/{attrs.get('slug', item.get('id'))}",
        external_rating=ext_rating,
    )
