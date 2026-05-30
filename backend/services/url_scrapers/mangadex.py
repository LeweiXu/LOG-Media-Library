"""Resolve a MangaDex title URL into a SearchResult via the MangaDex API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import country_to_origin


async def fetch(client, url: str) -> Optional[SearchResult]:
    # mangadex.org/title/<uuid>/<slug>
    m = re.search(r"mangadex\.org/title/([0-9a-fA-F-]{36})", url)
    if not m:
        return None
    uid = m.group(1)

    try:
        r = await client.get(
            f"https://api.mangadex.org/manga/{uid}", params={"includes[]": ["cover_art"]}
        )
        r.raise_for_status()
        item = r.json().get("data")
    except Exception:
        return None
    if not item:
        return None

    attrs = item.get("attributes", {})
    titles_dict = attrs.get("title", {})
    title = titles_dict.get("en") or next(iter(titles_dict.values()), "")
    if not title:
        return None

    cover_url: Optional[str] = None
    for rel in item.get("relationships", []):
        if rel.get("type") == "cover_art":
            fn = (rel.get("attributes") or {}).get("fileName")
            if fn:
                cover_url = f"https://uploads.mangadex.org/covers/{uid}/{fn}.512.jpg"
            break

    chapters = attrs.get("lastChapter")
    try:
        total = int(chapters) if chapters else None
    except (ValueError, TypeError):
        total = None

    orig_lang = attrs.get("originalLanguage", "")
    origin = country_to_origin(
        {"ja": "JP", "ko": "KR", "zh": "CN", "zh-hk": "HK"}.get(orig_lang, "")
    )
    if orig_lang in ("ko", "zh", "zh-hk"):
        medium = "Comic"
    elif attrs.get("format") == "novel":
        medium = "Light Novel"
    else:
        medium = "Manga"

    genre_tags = [
        t.get("attributes", {}).get("name", {}).get("en", "")
        for t in attrs.get("tags", [])
        if t.get("attributes", {}).get("group") == "genre"
    ]
    return SearchResult(
        title=title,
        medium=medium,
        origin=origin,
        year=attrs.get("year"),
        cover_url=cover_url,
        total=total,
        external_id=uid,
        source="mangadex",
        description=(attrs.get("description") or {}).get("en") or None,
        external_url=f"https://mangadex.org/title/{uid}",
        genres=", ".join(g for g in genre_tags[:5] if g) or None,
    )
