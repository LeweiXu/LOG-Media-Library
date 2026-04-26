from __future__ import annotations

import logging

import httpx

from schemas import ExploreItem, SearchResult
from .utils import settings, safe_year

logger = logging.getLogger(__name__)

_TMDB_GENRE_NAMES: dict[int, str] = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War",
    37: "Western", 10759: "Action & Adventure", 10762: "Kids", 10763: "News",
    10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap", 10767: "Talk",
    10768: "War & Politics",
}


async def search_tmdb(
    client: httpx.AsyncClient, title: str
) -> list[SearchResult]:
    api_key = settings.TMDB_API_KEY
    if not api_key:
        return []

    results: list[SearchResult] = []
    endpoints: list[tuple[str, str]] = [
        ("https://api.themoviedb.org/3/search/movie", "Film"),
        ("https://api.themoviedb.org/3/search/tv", "TV Show"),
    ]

    for url, med in endpoints:
        try:
            r = await client.get(
                url,
                params={"api_key": api_key, "query": title, "include_adult": "false"},
            )
            r.raise_for_status()
            for item in r.json().get("results", [])[:5]:
                poster = item.get("poster_path")
                item_id = str(item.get("id", ""))
                tmdb_type = "movie" if med == "Film" else "tv"
                cover = (
                    f"https://image.tmdb.org/t/p/w780{poster}" if poster else None
                )
                genre_ids = item.get("genre_ids") or []
                genres_str = ", ".join(
                    _TMDB_GENRE_NAMES[gid] for gid in genre_ids if gid in _TMDB_GENRE_NAMES
                ) or None
                vote_avg = item.get("vote_average")
                ext_rating = round(float(vote_avg), 1) if vote_avg else None
                results.append(
                    SearchResult(
                        title=item.get("title") or item.get("name", ""),
                        medium=med,
                        origin=None,
                        year=safe_year(
                            item.get("release_date") or item.get("first_air_date")
                        ),
                        cover_url=cover,
                        external_id=item_id,
                        source="tmdb",
                        description=item.get("overview") or None,
                        external_url=f"https://www.themoviedb.org/{tmdb_type}/{item_id}",
                        genres=genres_str,
                        external_rating=ext_rating,
                    )
                )
        except Exception as exc:
            logger.warning("TMDB search error: %s", exc)

    return results


async def _discover_tmdb(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    api_key = settings.TMDB_API_KEY
    if not api_key or medium not in ("Film", "TV Show"):
        return []
    tmdb_type = "movie" if medium == "Film" else "tv"
    try:
        r = await client.get(
            f"https://api.themoviedb.org/3/trending/{tmdb_type}/week",
            params={"api_key": api_key, "page": page},
        )
        r.raise_for_status()
    except Exception as exc:
        logger.warning("TMDB trending error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json().get("results", [])[:20]:
        item_id = str(item.get("id") or "")
        if not item_id:
            continue
        poster = item.get("poster_path")
        cover = f"https://image.tmdb.org/t/p/w780{poster}" if poster else None
        gids = item.get("genre_ids") or []
        genres_str = ", ".join(_TMDB_GENRE_NAMES[g] for g in gids if g in _TMDB_GENRE_NAMES) or None
        vote = item.get("vote_average")
        out.append(ExploreItem(
            title=item.get("title") or item.get("name") or "",
            medium=medium,
            year=safe_year(item.get("release_date") or item.get("first_air_date")),
            cover_url=cover,
            external_id=item_id,
            source="tmdb",
            description=item.get("overview") or None,
            external_url=f"https://www.themoviedb.org/{tmdb_type}/{item_id}",
            genres=genres_str,
            external_rating=round(float(vote), 1) if vote else None,
        ))
    return out
