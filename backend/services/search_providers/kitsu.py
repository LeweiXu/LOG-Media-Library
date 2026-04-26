from __future__ import annotations

import logging

import httpx

from schemas import SearchResult
from .utils import safe_year

logger = logging.getLogger(__name__)


async def search_kitsu(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    """
    Kitsu.io public API — no API key required.
    https://kitsu.docs.apiary.io/
    """
    results: list[SearchResult] = []
    endpoints: list[tuple[str, str]] = [
        ("https://kitsu.app/api/edge/anime", "Anime"),
        ("https://kitsu.app/api/edge/manga", "Manga"),
    ]

    headers = {"Accept": "application/vnd.api+json"}

    for url, med in endpoints:
        try:
            r = await client.get(
                url,
                params={"filter[text]": title, "page[limit]": 5},
                headers=headers,
            )
            r.raise_for_status()
            for item in r.json().get("data", []):
                attrs = item.get("attributes", {})
                display_title = (
                    (attrs.get("titles") or {}).get("en")
                    or (attrs.get("titles") or {}).get("en_jp")
                    or attrs.get("canonicalTitle", "")
                )
                poster = attrs.get("posterImage") or {}
                cover = (
                    poster.get("original")
                    or poster.get("large")
                    or poster.get("medium")
                )
                ep_count = attrs.get("episodeCount") or attrs.get("chapterCount")
                started = attrs.get("startDate") or ""
                year = safe_year(started[:4]) if started else None
                kitsu_id = str(item.get("id", ""))
                kitsu_type = "anime" if med == "Anime" else "manga"
                subtype = (attrs.get("subtype") or "").lower()
                if med == "Manga" and subtype in ("novel",):
                    med = "Light Novel"
                elif med == "Manga" and subtype in ("manhwa",):
                    med = "Comic"
                avg_rating_str = attrs.get("averageRating")
                try:
                    ext_rating = round(float(avg_rating_str) / 10, 1) if avg_rating_str else None
                except (ValueError, TypeError):
                    ext_rating = None
                results.append(
                    SearchResult(
                        title=display_title,
                        medium=med,
                        origin=None,
                        year=year,
                        cover_url=cover,
                        total=ep_count,
                        external_id=kitsu_id,
                        source="kitsu",
                        description=attrs.get("synopsis") or None,
                        external_url=f"https://kitsu.app/{kitsu_type}/{attrs.get('slug', kitsu_id)}",
                        external_rating=ext_rating,
                    )
                )
        except Exception as exc:
            logger.warning("Kitsu search error: %s", exc)

    return results
