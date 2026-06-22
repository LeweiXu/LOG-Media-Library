"""IMDb provider — keyword search, single-title detail, and Explore discovery.

IMDb has no official public API, and its HTML title pages sit behind an AWS WAF
JS challenge a plain client can't pass. But two of its backend surfaces are
reachable anonymously:

  * the **suggestion** endpoint (``v3.sg.media-imdb.com/suggestion``) — JSON
    autocomplete used for keyword search;
  * the **GraphQL** API (``api.graphql.imdb.com``) — used for full detail
    (rating, episode count, year, cover, genres, plot) and for popularity-ranked
    discovery via ``advancedTitleSearch``.

IMDb ratings are already on a 0–10 scale, so (unlike Goodreads/NovelUpdates) they
are passed through unscaled. ``fetch_imdb_detail`` is shared with the URL scraper
and the on-add enrich endpoint so a title resolves the same way everywhere.

Both surfaces are blocking ``curl_cffi`` calls run in a thread, mirroring the
Goodreads/NovelUpdates providers; any failure degrades to an empty/None result.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional
from urllib.parse import quote

from schemas import SearchResult

logger = logging.getLogger(__name__)

_SUGGEST = "https://v3.sg.media-imdb.com/suggestion/x/{q}.json"
_GRAPHQL = "https://api.graphql.imdb.com/"

# IMDb titleType / suggestion-qid → our medium. Names, episodes, etc. are skipped.
_TYPE_TO_MEDIUM = {
    "movie": "Film",
    "tvMovie": "Film",
    "short": "Film",
    "tvShort": "Film",
    "video": "Film",
    "tvSeries": "TV Show",
    "tvMiniSeries": "TV Show",
}

# Best-effort map of our genre names to IMDb genre ids (used to bias discovery).
_GENRE_TO_IMDB = {
    "Science Fiction": "Sci-Fi",
    "Sci-Fi": "Sci-Fi",
    "Action": "Action",
    "Adventure": "Adventure",
    "Animation": "Animation",
    "Comedy": "Comedy",
    "Crime": "Crime",
    "Documentary": "Documentary",
    "Drama": "Drama",
    "Family": "Family",
    "Fantasy": "Fantasy",
    "History": "History",
    "Horror": "Horror",
    "Music": "Music",
    "Mystery": "Mystery",
    "Romance": "Romance",
    "Thriller": "Thriller",
    "War": "War",
    "Western": "Western",
}


def _title_url(tt: str) -> str:
    return f"https://www.imdb.com/title/{tt}/"


def _rating(value) -> Optional[float]:
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


async def _get_json(url: str) -> Optional[dict | list]:
    from curl_cffi import requests as cffi_requests

    def _do() -> Optional[dict | list]:
        try:
            r = cffi_requests.get(url, timeout=15, impersonate="chrome")
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            logger.warning("IMDb GET error for %s: %s", url, exc)
            return None

    return await asyncio.get_event_loop().run_in_executor(None, _do)


async def _post_graphql(query: str) -> Optional[dict]:
    from curl_cffi import requests as cffi_requests

    def _do() -> Optional[dict]:
        try:
            r = cffi_requests.post(
                _GRAPHQL,
                json={"query": query},
                headers={"content-type": "application/json"},
                timeout=20,
                impersonate="chrome",
            )
            r.raise_for_status()
            data = r.json()
            if isinstance(data, dict) and data.get("errors"):
                logger.warning("IMDb GraphQL errors: %s", data["errors"][:1])
            return data
        except Exception as exc:
            logger.warning("IMDb GraphQL error: %s", exc)
            return None

    return await asyncio.get_event_loop().run_in_executor(None, _do)


# ── Keyword search (suggestion endpoint) ──────────────────────────────────────

async def search_imdb(
    client,       # httpx.AsyncClient — unused; kept for provider-API consistency
    title: str,
    limit: int = 10,
) -> list[SearchResult]:
    """Search IMDb titles via the suggestion autocomplete JSON."""
    q = quote((title or "").strip())
    if not q:
        return []
    data = await _get_json(_SUGGEST.format(q=q))
    items = data.get("d") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    results: list[SearchResult] = []
    for it in items[: max(1, min(limit, 20))]:
        if not isinstance(it, dict):
            continue
        tt = it.get("id") or ""
        if not tt.startswith("tt"):
            continue  # skip people (nm…/in…), companies, etc.
        medium = _TYPE_TO_MEDIUM.get(it.get("qid") or "")
        if not medium:
            continue
        img = it.get("i") or {}
        results.append(
            SearchResult(
                title=it.get("l") or "",
                medium=medium,
                origin=None,
                year=it.get("y"),
                cover_url=img.get("imageUrl") if isinstance(img, dict) else None,
                total=1 if medium == "Film" else None,
                external_id=tt,
                source="imdb",
                description=None,
                external_url=_title_url(tt),
                genres=None,
                external_rating=None,  # filled on add via fetch_imdb_detail
            )
        )
    return results


# ── Single-title detail (shared with URL scraper + enrich endpoint) ───────────

_DETAIL_QUERY = """
query {{
  title(id: "{tt}") {{
    titleText {{ text }}
    titleType {{ id }}
    releaseYear {{ year }}
    ratingsSummary {{ aggregateRating }}
    episodes {{ episodes(first: 0) {{ total }} }}
    primaryImage {{ url }}
    plot {{ plotText {{ plainText }} }}
    titleGenres {{ genres {{ genre {{ text }} }} }}
  }}
}}
"""


async def fetch_imdb_detail(tt: str) -> Optional[SearchResult]:
    """Resolve a single IMDb ``ttXXXXXXX`` id into a fully-populated SearchResult."""
    tt = (tt or "").strip()
    if not tt.startswith("tt"):
        return None
    data = await _post_graphql(_DETAIL_QUERY.format(tt=tt))
    title = (((data or {}).get("data") or {}).get("title")) if data else None
    if not isinstance(title, dict):
        return None

    name = (title.get("titleText") or {}).get("text")
    if not name:
        return None

    type_id = (title.get("titleType") or {}).get("id") or ""
    medium = _TYPE_TO_MEDIUM.get(type_id, "Film")

    year = (title.get("releaseYear") or {}).get("year")
    rating = _rating((title.get("ratingsSummary") or {}).get("aggregateRating"))

    total: Optional[int] = None
    if medium == "TV Show":
        eps = ((title.get("episodes") or {}).get("episodes") or {})
        total = eps.get("total")
    else:
        total = 1

    cover = (title.get("primaryImage") or {}).get("url")
    description = ((title.get("plot") or {}).get("plotText") or {}).get("plainText")

    genres = []
    for g in ((title.get("titleGenres") or {}).get("genres") or []):
        text = (g.get("genre") or {}).get("text") if isinstance(g, dict) else None
        if text:
            genres.append(text)

    return SearchResult(
        title=name,
        medium=medium,
        origin=None,
        year=year,
        cover_url=cover,
        total=total,
        external_id=tt,
        source="imdb",
        description=(description[:800] if description else None),
        external_url=_title_url(tt),
        genres=", ".join(dict.fromkeys(genres)) or None,
        external_rating=rating,
    )


# ── Explore discovery (popularity-ranked, genre-biased) ───────────────────────

_DISCOVER_QUERY = """
query {{
  advancedTitleSearch(first: 20, sort: {{ sortBy: POPULARITY, sortOrder: ASC }},
    constraints: {{ titleTypeConstraint: {{ anyTitleTypeIds: ["{type_id}"] }}{genre} }}) {{
    edges {{ node {{ title {{
      id
      titleText {{ text }}
      releaseYear {{ year }}
      ratingsSummary {{ aggregateRating }}
      primaryImage {{ url }}
      plot {{ plotText {{ plainText }} }}
      titleGenres {{ genres {{ genre {{ text }} }} }}
    }} }} }}
  }}
}}
"""


def _imdb_genre(top_genres: Optional[list[str]]) -> str:
    for g in (top_genres or []):
        gid = _GENRE_TO_IMDB.get(g)
        if gid:
            return f', genreConstraint: {{ allGenreIds: ["{gid}"] }}'
    return ""


async def _discover_imdb(client, medium: str, top_genres=None, page: int = 1):
    from schemas import ExploreItem

    type_id = {"Film": "movie", "TV Show": "tvSeries"}.get(medium)
    if not type_id:
        return []

    query = _DISCOVER_QUERY.format(type_id=type_id, genre=_imdb_genre(top_genres))
    data = await _post_graphql(query)
    edges = ((((data or {}).get("data") or {}).get("advancedTitleSearch") or {}).get("edges")) if data else None
    if not isinstance(edges, list):
        return []

    out = []
    for edge in edges:
        node = ((edge or {}).get("node") or {}).get("title") if isinstance(edge, dict) else None
        if not isinstance(node, dict):
            continue
        tt = node.get("id") or ""
        name = (node.get("titleText") or {}).get("text")
        if not tt or not name:
            continue
        genres = []
        for g in ((node.get("titleGenres") or {}).get("genres") or []):
            text = (g.get("genre") or {}).get("text") if isinstance(g, dict) else None
            if text:
                genres.append(text)
        plot = ((node.get("plot") or {}).get("plotText") or {}).get("plainText")
        out.append(ExploreItem(
            title=name,
            medium=medium,
            origin=None,
            year=(node.get("releaseYear") or {}).get("year"),
            cover_url=(node.get("primaryImage") or {}).get("url"),
            total=1 if medium == "Film" else None,
            external_id=tt,
            source="imdb",
            description=(plot[:800] if plot else None),
            external_url=_title_url(tt),
            genres=", ".join(dict.fromkeys(genres)) or None,
            external_rating=_rating((node.get("ratingsSummary") or {}).get("aggregateRating")),
        ))
    return out
