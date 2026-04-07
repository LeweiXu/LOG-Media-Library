from __future__ import annotations

import logging

import httpx

from schemas import SearchResult
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
                        description=desc[:200] or None,
                        external_url=f"https://anilist.co/{anilist_type}/{anilist_id}",
                        genres=genres_str,
                        external_rating=ext_rating,
                    )
                )
        except Exception as exc:
            logger.warning("AniList search error: %s", exc)

    return results
