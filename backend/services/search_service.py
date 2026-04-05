"""
External media search service.

Strategy:
  - Route the query to the most relevant provider(s) based on the requested medium.
  - If no medium is given, query all providers in parallel.
  - Results are normalised to SearchResult before being returned.
  - Any provider that fails is silently skipped so a partial result is always returned.
  - All providers are optional — if no API key is configured the provider is skipped.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

import httpx

from config import get_settings
from schemas import SearchResult

logger = logging.getLogger(__name__)
settings = get_settings()

# Medium strings as used in the frontend
_FILM_MEDIUMS   = {"Film"}
_TV_MEDIUMS     = {"TV Show"}
_ANIME_MEDIUMS  = {"Anime"}
_MANGA_MEDIUMS  = {"Manga", "Light Novel", "Web Novel", "Comics"}
_BOOK_MEDIUMS   = {"Book", "Light Novel", "Web Novel"}
_GAME_MEDIUMS   = {"Game"}

TIMEOUT = httpx.Timeout(8.0)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_year(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    try:
        return int(str(date_str)[:4])
    except (ValueError, TypeError):
        return None


# ── TMDB (Films & TV) ─────────────────────────────────────────────────────────

async def _search_tmdb(client: httpx.AsyncClient, title: str, medium: str) -> list[SearchResult]:
    api_key = settings.TMDB_API_KEY
    if not api_key:
        return []

    results: list[SearchResult] = []

    # Decide which TMDB endpoint(s) to call
    endpoints: list[tuple[str, str, str]] = []  # (url, media_type, origin_guess)
    if medium in _FILM_MEDIUMS or not medium:
        endpoints.append(("https://api.themoviedb.org/3/search/movie", "Film", ""))
    if medium in _TV_MEDIUMS or not medium:
        endpoints.append(("https://api.themoviedb.org/3/search/tv", "TV Show", ""))

    for url, med, _ in endpoints:
        try:
            r = await client.get(url, params={"api_key": api_key, "query": title})
            r.raise_for_status()
            for item in r.json().get("results", [])[:5]:
                poster = item.get("poster_path")
                results.append(SearchResult(
                    title=item.get("title") or item.get("name", ""),
                    medium=med,
                    year=_safe_year(item.get("release_date") or item.get("first_air_date")),
                    cover_url=f"https://image.tmdb.org/t/p/w200{poster}" if poster else None,
                    external_id=str(item.get("id")),
                    source="tmdb",
                    description=(item.get("overview") or "")[:200] or None,
                ))
        except Exception as exc:
            logger.warning("TMDB search error: %s", exc)

    return results


# ── AniList (Anime & Manga) ───────────────────────────────────────────────────

_ANILIST_QUERY = """
query ($search: String, $type: MediaType) {
  Page(page: 1, perPage: 5) {
    media(search: $search, type: $type) {
      id
      title { romaji english }
      type
      episodes
      chapters
      startDate { year }
      coverImage { medium }
      countryOfOrigin
    }
  }
}
"""

async def _search_anilist(client: httpx.AsyncClient, title: str, medium: str) -> list[SearchResult]:
    results: list[SearchResult] = []

    types_to_query: list[str] = []
    if medium in _ANIME_MEDIUMS or not medium:
        types_to_query.append("ANIME")
    if medium in _MANGA_MEDIUMS or not medium:
        types_to_query.append("MANGA")

    for media_type in types_to_query:
        try:
            r = await client.post(
                "https://graphql.anilist.co",
                json={"query": _ANILIST_QUERY, "variables": {"search": title, "type": media_type}},
            )
            r.raise_for_status()
            items = r.json().get("data", {}).get("Page", {}).get("media", [])
            for item in items:
                t = item.get("title", {})
                display_title = t.get("english") or t.get("romaji", "")
                med = "Anime" if media_type == "ANIME" else "Manga"
                total = item.get("episodes") or item.get("chapters")
                results.append(SearchResult(
                    title=display_title,
                    medium=med,
                    origin="Japanese",
                    year=item.get("startDate", {}).get("year"),
                    cover_url=item.get("coverImage", {}).get("medium"),
                    total=total,
                    external_id=str(item.get("id")),
                    source="anilist",
                ))
        except Exception as exc:
            logger.warning("AniList search error: %s", exc)

    return results


# ── IGDB (Games) ──────────────────────────────────────────────────────────────

async def _get_igdb_token(client: httpx.AsyncClient) -> Optional[str]:
    """Obtain a Twitch OAuth token for IGDB access."""
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


async def _search_igdb(client: httpx.AsyncClient, title: str, medium: str) -> list[SearchResult]:
    if medium and medium not in _GAME_MEDIUMS:
        return []

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
                f'fields name,first_release_date,cover.url,involved_companies.company.name; '
                f'limit 5;'
            ),
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json():
            cover = item.get("cover", {})
            cover_url = cover.get("url", "").replace("t_thumb", "t_cover_small") if cover else None
            if cover_url and cover_url.startswith("//"):
                cover_url = "https:" + cover_url
            ts = item.get("first_release_date")
            year = datetime.fromtimestamp(ts).year if ts else None
            results.append(SearchResult(
                title=item.get("name", ""),
                medium="Game",
                year=year,
                cover_url=cover_url,
                external_id=str(item.get("id")),
                source="igdb",
            ))
        return results
    except Exception as exc:
        logger.warning("IGDB search error: %s", exc)
        return []


# ── Google Books ──────────────────────────────────────────────────────────────

async def _search_google_books(client: httpx.AsyncClient, title: str, medium: str) -> list[SearchResult]:
    if medium and medium not in _BOOK_MEDIUMS:
        return []

    params: dict = {"q": title, "maxResults": 5, "printType": "books"}
    api_key = settings.GOOGLE_BOOKS_API_KEY
    if api_key:
        params["key"] = api_key

    try:
        r = await client.get("https://www.googleapis.com/books/v1/volumes", params=params)
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("items", []):
            info = item.get("volumeInfo", {})
            images = info.get("imageLinks", {})
            cover = images.get("thumbnail") or images.get("smallThumbnail")
            pub_date = info.get("publishedDate", "")
            year = _safe_year(pub_date)
            pages = info.get("pageCount")
            results.append(SearchResult(
                title=info.get("title", ""),
                medium="Book",
                year=year,
                cover_url=cover,
                total=pages,
                external_id=item.get("id"),
                source="google_books",
                description=(info.get("description") or "")[:200] or None,
            ))
        return results
    except Exception as exc:
        logger.warning("Google Books search error: %s", exc)
        return []


# ── Public interface ──────────────────────────────────────────────────────────

async def search_media(title: str, medium: str = "") -> list[SearchResult]:
    """
    Fan-out search across all relevant providers.
    Results are de-duplicated by (title, source) and capped at 10.
    """
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        tasks = [
            _search_tmdb(client, title, medium),
            _search_anilist(client, title, medium),
            _search_igdb(client, title, medium),
            _search_google_books(client, title, medium),
        ]
        groups = await asyncio.gather(*tasks, return_exceptions=True)

    combined: list[SearchResult] = []
    seen: set[tuple[str, str]] = set()

    for group in groups:
        if isinstance(group, Exception):
            logger.warning("Search provider error: %s", group)
            continue
        for result in group:
            key = (result.title.lower(), result.source)
            if key not in seen:
                seen.add(key)
                combined.append(result)

    return combined[:10]
