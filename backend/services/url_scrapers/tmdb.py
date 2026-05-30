"""Resolve a TMDB movie/TV URL into a SearchResult via the TMDB API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.utils import settings, safe_year


async def fetch(client, url: str) -> Optional[SearchResult]:
    # themoviedb.org/movie/27205  or  /tv/1396  (an optional -slug is ignored)
    m = re.search(r"/(movie|tv)/(\d+)", url)
    if not m:
        return None
    kind, tid = m.group(1), m.group(2)
    api_key = settings.TMDB_API_KEY
    if not api_key:
        return None

    try:
        r = await client.get(
            f"https://api.themoviedb.org/3/{kind}/{tid}", params={"api_key": api_key}
        )
        r.raise_for_status()
        d = r.json()
    except Exception:
        return None

    title = d.get("title") or d.get("name")
    if not title:
        return None

    poster = d.get("poster_path")
    vote = d.get("vote_average")
    return SearchResult(
        title=title,
        medium="Film" if kind == "movie" else "TV Show",
        origin=None,
        year=safe_year(d.get("release_date") or d.get("first_air_date")),
        cover_url=f"https://image.tmdb.org/t/p/w780{poster}" if poster else None,
        total=1 if kind == "movie" else d.get("number_of_episodes"),
        external_id=tid,
        source="tmdb",
        description=d.get("overview") or None,
        external_url=f"https://www.themoviedb.org/{kind}/{tid}",
        genres=", ".join(g["name"] for g in d.get("genres", []) if g.get("name")) or None,
        external_rating=round(float(vote), 1) if vote else None,
    )
