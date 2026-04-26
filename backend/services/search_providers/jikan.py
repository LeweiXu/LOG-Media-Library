from __future__ import annotations

import logging

import httpx

from schemas import ExploreItem, SearchResult
from .utils import safe_year

logger = logging.getLogger(__name__)


async def search_jikan(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    """
    Jikan v4 is a public MAL proxy — no API key required.
    https://jikan.moe/
    """
    results: list[SearchResult] = []
    endpoints: list[tuple[str, str]] = [
        ("https://api.jikan.moe/v4/anime", "Anime"),
        ("https://api.jikan.moe/v4/manga", "Manga"),
    ]

    for url, med in endpoints:
        try:
            r = await client.get(url, params={"q": title, "limit": 5, "sfw": "true"})
            r.raise_for_status()
            for item in r.json().get("data", []):
                titles = item.get("titles", [])
                display_title = next(
                    (t["title"] for t in titles if t.get("type") == "English"),
                    None,
                ) or item.get("title", "")
                images = item.get("images", {})
                jpg = images.get("jpg", {})
                webp = images.get("webp", {})
                cover = (
                    webp.get("large_image_url")
                    or jpg.get("large_image_url")
                    or webp.get("image_url")
                    or jpg.get("image_url")
                )
                mal_id = str(item.get("mal_id", ""))
                mal_type = "anime" if med == "Anime" else "manga"
                episodes = item.get("episodes") or item.get("chapters")
                aired = item.get("aired") or item.get("published") or {}
                prop = aired.get("prop", {}).get("from", {})
                year = prop.get("year") or safe_year(
                    (aired.get("from") or "")[:10] or None
                )
                mal_type_field = (item.get("type") or "").lower()
                if med == "Manga":
                    if "light novel" in mal_type_field or "novel" in mal_type_field:
                        med = "Light Novel"
                genres_str = ", ".join(
                    g["name"] for g in (item.get("genres") or [])[:5] if g.get("name")
                ) or None
                score = item.get("score")
                ext_rating = round(float(score), 1) if score else None
                results.append(
                    SearchResult(
                        title=display_title,
                        medium=med,
                        origin="Japanese",
                        year=year,
                        cover_url=cover,
                        total=episodes,
                        external_id=mal_id,
                        source="jikan",
                        description=item.get("synopsis") or None,
                        external_url=f"https://myanimelist.net/{mal_type}/{mal_id}",
                        genres=genres_str,
                        external_rating=ext_rating,
                    )
                )
        except Exception as exc:
            logger.warning("Jikan search error: %s", exc)

    return results


async def _discover_jikan(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    """Jikan top anime / top manga / top light novel — no API key required."""
    if medium not in ("Anime", "Manga", "Light Novel"):
        return []
    is_anime = medium == "Anime"
    endpoint = f"https://api.jikan.moe/v4/top/{'anime' if is_anime else 'manga'}"
    params = {"limit": 25, "filter": "bypopularity", "page": page}
    if medium == "Light Novel":
        params["type"] = "lightnovel"
    try:
        r = await client.get(endpoint, params=params)
        r.raise_for_status()
    except Exception as exc:
        logger.warning("Jikan top error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json().get("data", []):
        titles = item.get("titles") or []
        display = next((t["title"] for t in titles if t.get("type") == "English"), None) or item.get("title") or ""
        images = item.get("images") or {}
        jpg = images.get("jpg") or {}
        webp = images.get("webp") or {}
        cover = (
            webp.get("large_image_url") or jpg.get("large_image_url")
            or webp.get("image_url")    or jpg.get("image_url")
        )
        mal_id = str(item.get("mal_id") or "")
        aired = item.get("aired") or item.get("published") or {}
        prop = (aired.get("prop") or {}).get("from") or {}
        year = prop.get("year") or safe_year((aired.get("from") or "")[:10] or None)
        type_field = (item.get("type") or "").lower()
        if medium == "Manga" and "novel" in type_field:
            continue
        if medium == "Light Novel" and "novel" not in type_field:
            continue
        score = item.get("score")
        out.append(ExploreItem(
            title=display,
            medium=medium,
            origin="Japanese",
            year=year,
            cover_url=cover,
            total=item.get("episodes") or item.get("chapters"),
            external_id=mal_id,
            source="jikan",
            description=item.get("synopsis") or None,
            external_url=f"https://myanimelist.net/{'anime' if is_anime else 'manga'}/{mal_id}",
            genres=", ".join(g["name"] for g in (item.get("genres") or [])[:5] if g.get("name")) or None,
            external_rating=round(float(score), 1) if score else None,
        ))
    return out
