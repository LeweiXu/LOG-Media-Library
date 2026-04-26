from __future__ import annotations

import logging

import httpx

from schemas import ExploreItem, SearchResult
from .utils import country_to_origin

logger = logging.getLogger(__name__)

_ANILIST_QUERY = """
query ($search: String, $type: MediaType) {
  Page(page: 1, perPage: 8) {
    media(search: $search, type: $type, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      type
      format
      episodes
      chapters
      volumes
      startDate { year }
      coverImage { extraLarge large medium }
      countryOfOrigin
      description(asHtml: false)
      genres
      averageScore
    }
  }
}
"""

_ANILIST_FORMAT_TO_MEDIUM: dict[str, str] = {
    "TV": "Anime",
    "TV_SHORT": "Anime",
    "MOVIE": "Anime",
    "SPECIAL": "Anime",
    "OVA": "Anime",
    "ONA": "Anime",
    "MUSIC": "Anime",
    "MANGA": "Manga",
    "NOVEL": "Light Novel",
    "ONE_SHOT": "Manga",
}

_ANILIST_TRENDING = """
query ($type: MediaType, $perPage: Int!, $page: Int!) {
  Page(page: $page, perPage: $perPage) {
    media(type: $type, sort: TRENDING_DESC, isAdult: false) {
      id
      title { english romaji native }
      type format episodes chapters
      startDate { year }
      coverImage { extraLarge large }
      countryOfOrigin
      description(asHtml: false)
      genres
      averageScore
    }
  }
}
"""


async def search_anilist(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    results: list[SearchResult] = []
    types_to_query = ["ANIME", "MANGA"]

    for media_type in types_to_query:
        try:
            r = await client.post(
                "https://graphql.anilist.co",
                json={
                    "query": _ANILIST_QUERY,
                    "variables": {"search": title, "type": media_type},
                },
            )
            r.raise_for_status()
            items = (
                r.json().get("data", {}).get("Page", {}).get("media", [])
            )
            for item in items:
                t = item.get("title", {})
                display_title = (
                    t.get("english") or t.get("romaji") or t.get("native", "")
                )
                fmt = item.get("format", "")
                med = _ANILIST_FORMAT_TO_MEDIUM.get(fmt, "Anime" if media_type == "ANIME" else "Manga")
                total = item.get("episodes") or item.get("chapters")
                anilist_id = str(item.get("id", ""))
                anilist_type = "anime" if media_type == "ANIME" else "manga"
                cover_img = item.get("coverImage", {})
                cover = (
                    cover_img.get("extraLarge")
                    or cover_img.get("large")
                    or cover_img.get("medium")
                )
                origin = country_to_origin(item.get("countryOfOrigin"))
                desc = item.get("description") or ""
                genres_str = ", ".join((item.get("genres") or [])[:5]) or None
                avg_score = item.get("averageScore")
                ext_rating = round(avg_score / 10, 1) if avg_score else None
                results.append(
                    SearchResult(
                        title=display_title,
                        medium=med,
                        origin=origin,
                        year=item.get("startDate", {}).get("year"),
                        cover_url=cover,
                        total=total,
                        external_id=anilist_id,
                        source="anilist",
                        description=desc or None,
                        external_url=f"https://anilist.co/{anilist_type}/{anilist_id}",
                        genres=genres_str,
                        external_rating=ext_rating,
                    )
                )
        except Exception as exc:
            logger.warning("AniList search error: %s", exc)

    return results


async def _discover_anilist(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    if medium not in ("Anime", "Manga", "Light Novel"):
        return []
    media_type = "ANIME" if medium == "Anime" else "MANGA"
    try:
        r = await client.post(
            "https://graphql.anilist.co",
            json={"query": _ANILIST_TRENDING, "variables": {"type": media_type, "perPage": 30, "page": page}},
        )
        r.raise_for_status()
    except Exception as exc:
        logger.warning("AniList trending error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json().get("data", {}).get("Page", {}).get("media", []):
        t = item.get("title") or {}
        display = t.get("english") or t.get("romaji") or t.get("native") or ""
        fmt = item.get("format") or ""
        med = _ANILIST_FORMAT_TO_MEDIUM.get(fmt, "Anime" if media_type == "ANIME" else "Manga")
        if medium == "Light Novel" and med != "Light Novel":
            continue
        if medium == "Manga" and med == "Light Novel":
            continue
        if medium == "Anime" and med != "Anime":
            continue
        anilist_id = str(item.get("id") or "")
        cover_img = item.get("coverImage") or {}
        cover = cover_img.get("extraLarge") or cover_img.get("large")
        score = item.get("averageScore")
        out.append(ExploreItem(
            title=display,
            medium=med,
            origin=country_to_origin(item.get("countryOfOrigin")),
            year=(item.get("startDate") or {}).get("year"),
            cover_url=cover,
            total=item.get("episodes") or item.get("chapters"),
            external_id=anilist_id,
            source="anilist",
            description=item.get("description") or None,
            external_url=f"https://anilist.co/{'anime' if media_type == 'ANIME' else 'manga'}/{anilist_id}",
            genres=", ".join((item.get("genres") or [])[:5]) or None,
            external_rating=round(score / 10, 1) if score else None,
        ))
    return out
