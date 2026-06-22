from __future__ import annotations

import logging
import re

import httpx

from schemas import ExploreItem, SearchResult
from .utils import safe_year, country_to_origin

logger = logging.getLogger(__name__)

# VNDB descriptions carry BBCode-ish markup ([url=…]…[/url], [spoiler], [b], …)
# and literal newlines. Strip the tags and collapse whitespace into a clean blurb.
_BB_URL = re.compile(r"\[url=[^\]]*\](.*?)\[/url\]", re.S | re.I)
_BB_TAG = re.compile(r"\[/?[a-z][^\]]*\]", re.I)


def _clean_description(text) -> str | None:
    if not text or not isinstance(text, str):
        return None
    cleaned = _BB_URL.sub(r"\1", text)
    cleaned = _BB_TAG.sub("", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:800] or None

# VNDB language code → origin mapping (lowercase keys)
_LANG_TO_ORIGIN: dict[str, str] = {
    "ja": "Japanese",
    "zh": "Chinese",
    "zh-hans": "Chinese",
    "zh-hant": "Chinese",
    "ko": "Korean",
    "en": "Western",
    "de": "Western",
    "fr": "Western",
    "es": "Western",
    "it": "Western",
    "pt": "Western",
    "pt-br": "Western",
    "ru": "Western",
}


async def search_vndb(
    client: httpx.AsyncClient, title: str, limit: int = 10
) -> list[SearchResult]:
    """
    VNDB public API — no API key required.
    https://api.vndb.org/kana
    """
    try:
        r = await client.post(
            "https://api.vndb.org/kana/vn",
            json={
                "filters": ["search", "=", title],
                "fields": "id,title,released,rating,image.url,olang,tags.name,description",
                "results": max(1, min(limit, 100)),
            },
        )
        r.raise_for_status()
        items = r.json().get("results", [])
    except Exception as exc:
        logger.warning("VNDB search error: %s", exc)
        return []

    results: list[SearchResult] = []
    for item in items:
        vndb_id = item.get("id", "")
        item_title = item.get("title") or ""
        if not item_title:
            continue

        year = safe_year(item.get("released"))

        olang = (item.get("olang") or "").lower()
        origin = _LANG_TO_ORIGIN.get(olang, "Other") if olang else None

        raw_rating = item.get("rating")
        try:
            ext_rating = round(float(raw_rating) / 10, 1) if raw_rating else None
        except (ValueError, TypeError):
            ext_rating = None

        image = item.get("image") or {}
        cover = image.get("url") or None

        tags = item.get("tags") or []
        genres = ", ".join(t["name"] for t in tags if t.get("name"))[:500] or None

        results.append(
            SearchResult(
                title=item_title,
                medium="Visual Novel",
                origin=origin,
                year=year,
                cover_url=cover,
                external_id=vndb_id,
                source="vndb",
                description=_clean_description(item.get("description")),
                external_url=f"https://vndb.org/{vndb_id}",
                external_rating=ext_rating,
                genres=genres,
            )
        )

    return results


async def _discover_vndb(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    if medium != "Visual Novel":
        return []
    try:
        r = await client.post(
            "https://api.vndb.org/kana/vn",
            json={
                "filters": ["rating", ">", 70],
                "fields": "id,title,released,rating,image.url,olang,tags.name,description",
                "sort": "rating",
                "reverse": True,
                "results": 25,
                "page": page,
            },
        )
        r.raise_for_status()
    except Exception as exc:
        logger.warning("VNDB discover error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json().get("results", []):
        vndb_id = item.get("id") or ""
        title = item.get("title") or ""
        if not vndb_id or not title:
            continue
        raw_rating = item.get("rating")
        try:
            ext_rating = round(float(raw_rating) / 10, 1) if raw_rating else None
        except (ValueError, TypeError):
            ext_rating = None
        lang = (item.get("olang") or "").lower()
        tags = item.get("tags") or []
        out.append(ExploreItem(
            title=title,
            medium="Visual Novel",
            origin=_LANG_TO_ORIGIN.get(lang, "Other") if lang else None,
            year=safe_year(item.get("released")),
            cover_url=(item.get("image") or {}).get("url"),
            external_id=vndb_id,
            source="vndb",
            description=_clean_description(item.get("description")),
            external_url=f"https://vndb.org/{vndb_id}",
            genres=", ".join(t["name"] for t in tags[:8] if t.get("name")) or None,
            external_rating=ext_rating,
        ))
    return out
