"""Resolve a single IMDb title URL into a SearchResult.

IMDb's own HTML pages sit behind an AWS WAF JS challenge a plain client can't
pass, but its **GraphQL** API is reachable anonymously, so we resolve the
``ttXXXXXXX`` id straight through ``search_providers.imdb.fetch_imdb_detail``
(IMDb rating, episode count, year, cover, genres, plot). If that fails we fall
back to TMDB's ``/find`` endpoint (the project already configures
``TMDB_API_KEY``), and finally to a best-effort JSON-LD scrape (usually blocked,
hence a graceful ``None``). Every path records ``source="imdb"``.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

import httpx

from schemas import SearchResult
from services.search_providers.tmdb import _TMDB_GENRE_NAMES
from services.search_providers.utils import settings, safe_year
from ._common import fetch_bytes

logger = logging.getLogger(__name__)

_TYPE_TO_MEDIUM = {
    "Movie": "Film",
    "TVSeries": "TV Show",
    "TVMiniSeries": "TV Show",
    "TVEpisode": "TV Show",
}


def _tt_id(url: str) -> Optional[str]:
    m = re.search(r"/title/(tt\d+)", url)
    return m.group(1) if m else None


def _from_tmdb_item(item: dict, medium: str, tt: str, total: Optional[int]) -> SearchResult:
    poster = item.get("poster_path")
    cover = f"https://image.tmdb.org/t/p/w780{poster}" if poster else None
    gids = item.get("genre_ids") or []
    genres = ", ".join(_TMDB_GENRE_NAMES[g] for g in gids if g in _TMDB_GENRE_NAMES) or None
    vote = item.get("vote_average")
    return SearchResult(
        title=item.get("title") or item.get("name") or "",
        medium=medium,
        origin=None,  # let the user set origin
        year=safe_year(item.get("release_date") or item.get("first_air_date")),
        cover_url=cover,
        total=total,
        external_id=tt,
        source="imdb",
        description=item.get("overview") or None,
        external_url=f"https://www.imdb.com/title/{tt}/",
        genres=genres,
        external_rating=round(float(vote), 1) if vote else None,
    )


async def _tv_episode_count(client: httpx.AsyncClient, tmdb_id: int, api_key: str) -> Optional[int]:
    """Total episode count from TMDB's TV detail endpoint."""
    try:
        r = await client.get(
            f"https://api.themoviedb.org/3/tv/{tmdb_id}", params={"api_key": api_key}
        )
        r.raise_for_status()
        return r.json().get("number_of_episodes") or None
    except Exception as exc:
        logger.warning("TMDB tv detail error for %s: %s", tmdb_id, exc)
        return None


async def _resolve_via_tmdb(client: httpx.AsyncClient, tt: str) -> Optional[SearchResult]:
    api_key = settings.TMDB_API_KEY
    if not api_key:
        return None
    try:
        r = await client.get(
            f"https://api.themoviedb.org/3/find/{tt}",
            params={"api_key": api_key, "external_source": "imdb_id"},
        )
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        logger.warning("IMDb→TMDB find error for %s: %s", tt, exc)
        return None

    movies = data.get("movie_results") or []
    tv = data.get("tv_results") or []
    if movies:
        # A film is a single unit of progress.
        return _from_tmdb_item(movies[0], "Film", tt, total=1)
    if tv:
        episodes = await _tv_episode_count(client, tv[0].get("id"), api_key)
        return _from_tmdb_item(tv[0], "TV Show", tt, total=episodes)
    return None


async def _scrape_jsonld(tt: str) -> Optional[SearchResult]:
    """Fallback: parse the IMDb page's JSON-LD. Usually WAF-blocked → None."""
    raw = await fetch_bytes(f"https://www.imdb.com/title/{tt}/")
    if not raw:
        return None

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(raw, "lxml")
    block = soup.find("script", attrs={"type": "application/ld+json"})
    if not block or not block.string:
        return None
    try:
        data = json.loads(block.string)
    except (ValueError, TypeError):
        return None

    name = data.get("name")
    if not name:
        return None

    medium = _TYPE_TO_MEDIUM.get(data.get("@type") or "", "Film")
    year = None
    published = data.get("datePublished")
    if published:
        m = re.match(r"(\d{4})", str(published))
        if m:
            year = int(m.group(1))
    genre = data.get("genre")
    genres = ", ".join(genre) if isinstance(genre, list) else (genre if isinstance(genre, str) else None)
    external_rating = None
    agg = data.get("aggregateRating")
    if isinstance(agg, dict):
        try:
            external_rating = round(float(agg.get("ratingValue")), 1)
        except (TypeError, ValueError):
            external_rating = None

    return SearchResult(
        title=name,
        medium=medium,
        origin=None,
        year=year,
        cover_url=data.get("image") if isinstance(data.get("image"), str) else None,
        total=1 if medium == "Film" else None,
        external_id=tt,
        source="imdb",
        description=data.get("description") or None,
        external_url=f"https://www.imdb.com/title/{tt}/",
        genres=genres,
        external_rating=external_rating,
    )


async def fetch(client, url: str) -> Optional[SearchResult]:
    tt = _tt_id(url)
    if not tt:
        return None
    # Primary: IMDb's own GraphQL (real IMDb rating + episode count). Fall back to
    # TMDB resolution, then a JSON-LD scrape, if GraphQL is unavailable.
    from services.search_providers.imdb import fetch_imdb_detail

    result = await fetch_imdb_detail(tt)
    if result is None:
        result = await _resolve_via_tmdb(client, tt)
    if result is None:
        result = await _scrape_jsonld(tt)
    return result
