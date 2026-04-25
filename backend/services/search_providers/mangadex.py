from __future__ import annotations

import logging
from typing import Optional

import httpx

from schemas import SearchResult
from .utils import country_to_origin

logger = logging.getLogger(__name__)


async def search_mangadex(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    """
    MangaDex public API — no API key required.
    https://api.mangadex.org/docs/
    """
    try:
        r = await client.get(
            "https://api.mangadex.org/manga",
            params={
                "title": title,
                "limit": 8,
                "includes[]": ["cover_art", "author"],
                "contentRating[]": ["safe", "suggestive"],
                "order[relevance]": "desc",
            },
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("data", []):
            attrs = item.get("attributes", {})
            titles_dict = attrs.get("title", {})
            display_title = (
                titles_dict.get("en")
                or next(iter(titles_dict.values()), "")
            )
            cover_url: Optional[str] = None
            for rel in item.get("relationships", []):
                if rel.get("type") == "cover_art":
                    filename = (rel.get("attributes") or {}).get("fileName")
                    if filename:
                        cover_url = (
                            f"https://uploads.mangadex.org/covers/{item['id']}/{filename}.512.jpg"
                        )
                    break
            pub_year = attrs.get("year")
            chapters = attrs.get("lastChapter")
            try:
                total = int(chapters) if chapters else None
            except (ValueError, TypeError):
                total = None
            orig_lang = attrs.get("originalLanguage", "")
            origin = country_to_origin(
                {"ja": "JP", "ko": "KR", "zh": "CN", "zh-hk": "HK"}.get(orig_lang, "")
            )
            if orig_lang in ("ko",):
                med_resolved = "Comic"
            elif orig_lang in ("zh", "zh-hk"):
                med_resolved = "Comic"
            else:
                novel_flag = any(
                    (t.get("attributes", {}).get("name", {}).get("en", "")).lower() == "novel"
                    for t in item.get("relationships", [])
                )
                if attrs.get("format") == "novel" or novel_flag:
                    med_resolved = "Light Novel"
                else:
                    med_resolved = "Manga"
            mdx_id = item.get("id", "")
            genre_tags = [
                t.get("attributes", {}).get("name", {}).get("en", "")
                for t in attrs.get("tags", [])
                if t.get("attributes", {}).get("group") == "genre"
            ]
            genres_str = ", ".join(g for g in genre_tags[:5] if g) or None
            results.append(
                SearchResult(
                    title=display_title,
                    medium=med_resolved,
                    origin=origin,
                    year=pub_year,
                    cover_url=cover_url,
                    total=total,
                    external_id=mdx_id,
                    source="mangadex",
                    description=(attrs.get("description", {}).get("en") or "")[:200] or None,
                    external_url=f"https://mangadex.org/title/{mdx_id}",
                    genres=genres_str,
                )
            )
        return results
    except Exception as exc:
        logger.warning("MangaDex search error: %s", exc)
        return []
