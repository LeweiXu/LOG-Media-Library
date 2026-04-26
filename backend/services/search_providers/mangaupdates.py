from __future__ import annotations

import logging
import re

import httpx

from schemas import SearchResult

logger = logging.getLogger(__name__)

_MANGAUPDATES_TYPE_TO_MEDIUM: dict[str, str] = {
    "Manga": "Manga",
    "Manhwa": "Comic",
    "Manhua": "Comic",
    "Novel": "Light Novel",
    "Light Novel": "Light Novel",
    "Doujinshi": "Manga",
    "OEL": "Comic",
    "Artbook": "Manga",
}


async def search_mangaupdates(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    """
    MangaUpdates public API — no API key required.
    https://api.mangaupdates.com/
    Credit: MangaUpdates (per their acceptable use policy).
    """
    try:
        r = await client.post(
            "https://api.mangaupdates.com/v1/series/search",
            json={"search": title, "perpage": 8},
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("results", []):
            record = item.get("record", {})
            mu_id = str(record.get("series_id", ""))
            display_title = record.get("title", "")
            img = record.get("image", {})
            img_url = img.get("url", {})
            cover = (
                img_url.get("original")
                or img_url.get("thumb")
            )
            year_str = record.get("year") or ""
            try:
                year = int(str(year_str)[:4]) if year_str else None
            except (ValueError, TypeError):
                year = None
            mu_type = record.get("type") or ""
            med_resolved = _MANGAUPDATES_TYPE_TO_MEDIUM.get(mu_type, "Manga")
            if mu_type == "Manhwa":
                origin = "Korean"
            elif mu_type == "Manhua":
                origin = "Chinese"
            elif mu_type in ("OEL",):
                origin = "Western"
            else:
                origin = "Japanese"
            desc = record.get("description") or ""
            desc = re.sub(r"<[^>]+>", "", desc)
            mu_genres = record.get("genres") or []
            genres_str = ", ".join(
                g["genre"] for g in mu_genres[:5] if g.get("genre")
            ) or None
            bayesian = record.get("bayesian_rating")
            try:
                ext_rating = round(float(bayesian), 1) if bayesian else None
            except (ValueError, TypeError):
                ext_rating = None
            results.append(
                SearchResult(
                    title=display_title,
                    medium=med_resolved,
                    origin=origin,
                    year=year,
                    cover_url=cover,
                    external_id=mu_id,
                    source="mangaupdates",
                    description=desc or None,
                    external_url=record.get("url"),
                    genres=genres_str,
                    external_rating=ext_rating,
                )
            )
        return results
    except Exception as exc:
        logger.warning("MangaUpdates search error: %s", exc)
        return []
