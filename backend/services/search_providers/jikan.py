from __future__ import annotations

import asyncio
import collections
import logging
import time

import httpx

from schemas import ExploreItem, SearchResult
from .utils import safe_year

logger = logging.getLogger(__name__)


class _RateLimiter:
    """Process-wide async throttle for Jikan.

    Jikan (the public MyAnimeList proxy) allows ~3 requests/second and 60/minute;
    Explore's page fan-out blows past that and trips 429s. Every Jikan request
    goes through ``_jikan_get``, which serialises on this limiter so starts are
    spaced and the rolling per-minute cap is respected. Kept just under the
    documented limits for safety.
    """

    def __init__(self, per_second: float = 2.5, per_minute: int = 55) -> None:
        self._min_interval = 1.0 / per_second
        self._per_minute = per_minute
        self._lock = asyncio.Lock()
        self._last = 0.0
        self._times: collections.deque[float] = collections.deque()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            while self._times and now - self._times[0] > 60:
                self._times.popleft()
            wait = self._min_interval - (now - self._last)
            if len(self._times) >= self._per_minute:
                wait = max(wait, 60 - (now - self._times[0]))
            if wait > 0:
                await asyncio.sleep(wait)
                now = time.monotonic()
            self._last = now
            self._times.append(now)


_limiter = _RateLimiter()


async def _jikan_get(client: httpx.AsyncClient, url: str, params: dict) -> httpx.Response:
    """Throttled GET against Jikan; all callers must use this, not client.get."""
    await _limiter.acquire()
    return await client.get(url, params=params)


async def search_jikan(
    client: httpx.AsyncClient, title: str, limit: int = 10
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
    per_endpoint = max(1, min(limit, 25))

    for url, med in endpoints:
        try:
            r = await _jikan_get(client, url, {"q": title, "limit": per_endpoint, "sfw": "true"})
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
                # Resolve the per-item medium (the /manga endpoint also returns
                # light novels). Use a local so it doesn't leak across items.
                mal_type_field = (item.get("type") or "").lower()
                if med == "Manga" and "novel" in mal_type_field:
                    item_medium = "Light Novel"
                else:
                    item_medium = med
                # Total unit differs by medium: episodes for anime, volumes for
                # light novels, chapters for manga/comics.
                if item_medium == "Anime":
                    total = item.get("episodes")
                elif item_medium == "Light Novel":
                    total = item.get("volumes")
                else:
                    total = item.get("chapters")
                aired = item.get("aired") or item.get("published") or {}
                prop = aired.get("prop", {}).get("from", {})
                year = prop.get("year") or safe_year(
                    (aired.get("from") or "")[:10] or None
                )
                genres_str = ", ".join(
                    g["name"] for g in (item.get("genres") or [])[:5] if g.get("name")
                ) or None
                score = item.get("score")
                ext_rating = round(float(score), 1) if score else None
                results.append(
                    SearchResult(
                        title=display_title,
                        medium=item_medium,
                        origin="Japanese",
                        year=year,
                        cover_url=cover,
                        total=total,
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
        r = await _jikan_get(client, endpoint, params)
        r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Let a real outage (502/503/504) propagate so Explore can surface the
        # "MyAnimeList/Jikan API is down" message; rate-limits / 4xx stay
        # graceful (return empty so a fallback provider can fill in).
        if exc.response.status_code >= 500:
            raise
        logger.warning("Jikan top error: %s", exc)
        return []
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
