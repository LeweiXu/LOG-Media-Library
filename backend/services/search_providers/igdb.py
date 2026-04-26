from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

import httpx

from schemas import ExploreItem, SearchResult
from .utils import settings

logger = logging.getLogger(__name__)


async def _get_igdb_token(client: httpx.AsyncClient) -> Optional[str]:
    client_id     = settings.IGDB_CLIENT_ID
    client_secret = settings.IGDB_CLIENT_SECRET
    if not client_id or not client_secret:
        return None
    try:
        r = await client.post(
            "https://id.twitch.tv/oauth2/token",
            params={
                "client_id":     client_id,
                "client_secret": client_secret,
                "grant_type":    "client_credentials",
            },
        )
        r.raise_for_status()
        return r.json().get("access_token")
    except Exception as exc:
        logger.warning("IGDB token error: %s", exc)
        return None


async def search_igdb(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    client_id = settings.IGDB_CLIENT_ID
    if not client_id:
        return []

    token = await _get_igdb_token(client)
    if not token:
        return []

    try:
        r = await client.post(
            "https://api.igdb.com/v4/games",
            headers={
                "Client-ID":     client_id,
                "Authorization": f"Bearer {token}",
            },
            content=(
                f'search "{title}"; '
                f'fields name,first_release_date,cover.url,cover.image_id,'
                f'summary,involved_companies.company.name,url,genres.name,rating; '
                f'limit 5;'
            ),
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json():
            cover = item.get("cover", {})
            image_id = cover.get("image_id") if cover else None
            if image_id:
                cover_url: Optional[str] = (
                    f"https://images.igdb.com/igdb/image/upload/t_cover_big_2x/{image_id}.jpg"
                )
            else:
                raw_url = (cover.get("url") or "") if cover else ""
                cover_url = (
                    raw_url.replace("t_thumb", "t_cover_big_2x")
                    if raw_url else None
                )
            if cover_url and cover_url.startswith("//"):
                cover_url = "https:" + cover_url
            ts = item.get("first_release_date")
            year = datetime.fromtimestamp(ts).year if ts else None
            igdb_genres = item.get("genres") or []
            genres_str = ", ".join(
                g["name"] for g in igdb_genres[:5] if isinstance(g, dict) and g.get("name")
            ) or None
            igdb_rating = item.get("rating")
            ext_rating = round(igdb_rating / 10, 1) if igdb_rating else None
            results.append(
                SearchResult(
                    title=item.get("name", ""),
                    medium="Game",
                    origin=None,
                    year=year,
                    cover_url=cover_url,
                    external_id=str(item.get("id", "")),
                    source="igdb",
                    description=item.get("summary") or None,
                    external_url=item.get("url"),
                    genres=genres_str,
                    external_rating=ext_rating,
                )
            )
        return results
    except Exception as exc:
        logger.warning("IGDB search error: %s", exc)
        return []


async def _discover_igdb(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    if medium != "Game":
        return []
    client_id = settings.IGDB_CLIENT_ID
    if not client_id:
        return []
    token = await _get_igdb_token(client)
    if not token:
        return []
    cutoff = int(datetime.utcnow().timestamp()) - (3 * 365 * 86400)
    offset = max(0, (page - 1) * 25)
    try:
        r = await client.post(
            "https://api.igdb.com/v4/games",
            headers={"Client-ID": client_id, "Authorization": f"Bearer {token}"},
            content=(
                f"fields name,first_release_date,cover.image_id,"
                f"summary,url,genres.name,rating,total_rating_count; "
                f"where first_release_date > {cutoff} & cover != null & total_rating_count > 25; "
                f"sort total_rating_count desc; "
                f"limit 25; offset {offset};"
            ),
        )
        r.raise_for_status()
    except Exception as exc:
        logger.warning("IGDB discover error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json():
        cover = item.get("cover") or {}
        image_id = cover.get("image_id")
        cover_url = (
            f"https://images.igdb.com/igdb/image/upload/t_cover_big_2x/{image_id}.jpg"
            if image_id else None
        )
        ts = item.get("first_release_date")
        year = datetime.fromtimestamp(ts).year if ts else None
        rating = item.get("rating")
        out.append(ExploreItem(
            title=item.get("name") or "",
            medium="Game",
            year=year,
            cover_url=cover_url,
            external_id=str(item.get("id") or ""),
            source="igdb",
            description=item.get("summary") or None,
            external_url=item.get("url"),
            genres=", ".join(g["name"] for g in (item.get("genres") or [])[:5] if g.get("name")) or None,
            external_rating=round(rating / 10, 1) if rating else None,
        ))
    return out
