"""Resolve a MangaUpdates series URL into a SearchResult via the MangaUpdates API."""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.mangaupdates import (
    _MANGAUPDATES_TYPE_TO_MEDIUM,
    _latest_chapter,
)

_TYPE_TO_ORIGIN = {"Manhwa": "Korean", "Manhua": "Chinese", "OEL": "Western"}


def _series_id(url: str) -> Optional[int]:
    # New URLs: mangaupdates.com/series/<base36>/<slug>
    m = re.search(r"/series/([a-z0-9]+)", url)
    if m and not m.group(1).isdigit():
        try:
            return int(m.group(1), 36)
        except ValueError:
            return None
    # Legacy URLs: mangaupdates.com/series.html?id=<decimal>
    m = re.search(r"[?&]id=(\d+)", url)
    if m:
        return int(m.group(1))
    if m := re.search(r"/series/(\d+)", url):
        return int(m.group(1))
    return None


async def fetch(client, url: str) -> Optional[SearchResult]:
    series_id = _series_id(url)
    if series_id is None:
        return None

    try:
        r = await client.get(f"https://api.mangaupdates.com/v1/series/{series_id}")
        r.raise_for_status()
        d = r.json()
    except Exception:
        return None

    title = d.get("title")
    if not title:
        return None

    img = (d.get("image") or {}).get("url") or {}
    mu_type = d.get("type") or ""
    bayes = d.get("bayesian_rating")
    try:
        ext_rating = round(float(bayes), 1) if bayes else None
    except (ValueError, TypeError):
        ext_rating = None
    year_str = d.get("year")
    try:
        year = int(str(year_str)[:4]) if year_str else None
    except (ValueError, TypeError):
        year = None

    latest = d.get("latest_chapter")
    total = int(latest) if latest else await _latest_chapter(client, series_id)

    return SearchResult(
        title=title,
        medium=_MANGAUPDATES_TYPE_TO_MEDIUM.get(mu_type, "Manga"),
        origin=_TYPE_TO_ORIGIN.get(mu_type, "Japanese"),
        year=year,
        cover_url=img.get("original") or img.get("thumb"),
        total=total,
        external_id=str(series_id),
        source="mangaupdates",
        description=re.sub(r"<[^>]+>", "", d.get("description") or "") or None,
        external_url=d.get("url"),
        genres=", ".join(g["genre"] for g in (d.get("genres") or [])[:5] if g.get("genre")) or None,
        external_rating=ext_rating,
    )
