"""Scrape a single NovelUpdates series page into a SearchResult.

Reuses the cover-normalisation helper already written for the keyword-search
scraper and the same Cloudflare-bypass fetch path. The series page layout
differs from the Series Finder result boxes, so the selectors here are its own.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from schemas import SearchResult
from services.search_providers.novelupdates import _normalise_cover_url
from ._common import fetch_bytes

logger = logging.getLogger(__name__)

# NovelUpdates spells the original language out in full on the series page.
_LANG_ORIGINS = {"Chinese", "Korean", "Japanese"}


def _title_from_slug(slug: str) -> str:
    """Build a readable fallback title when NovelUpdates blocks the page."""
    small_words = {"a", "an", "and", "as", "at", "for", "from", "in", "of", "on", "or", "the", "to", "with"}
    words = [w for w in slug.replace("_", "-").split("-") if w]
    titled = []
    for i, word in enumerate(words):
        lower = word.lower()
        titled.append(lower if i > 0 and lower in small_words else lower.capitalize())
    return " ".join(titled)


def _fallback_result(slug: str) -> SearchResult:
    return SearchResult(
        title=_title_from_slug(slug),
        medium="Web Novel",
        origin=None,
        year=None,
        cover_url=None,
        total=None,
        external_id=slug,
        source="novelupdates",
        description=None,
        external_url=f"https://www.novelupdates.com/series/{slug}/",
        genres=None,
        external_rating=None,
    )


async def fetch(client, url: str) -> Optional[SearchResult]:
    # Series URLs look like https://www.novelupdates.com/series/<slug>/
    m = re.search(r"/series/([^/?#]+)", url)
    if not m:
        return None
    slug = m.group(1)

    raw = await fetch_bytes(f"https://www.novelupdates.com/series/{slug}/")
    if not raw:
        return _fallback_result(slug)

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(raw, "lxml")

    title_tag = soup.select_one("div.seriestitlenu")
    title = title_tag.get_text(strip=True) if title_tag else None
    if not title:
        return _fallback_result(slug)

    img = soup.select_one("div.seriesimg img")
    cover_url = _normalise_cover_url(img.get("src") or img.get("data-src") or "") if img else None

    # Hidden input carries the numeric series id used elsewhere as external_id.
    series_id = slug
    pid = soup.select_one("#mypostid")
    if pid and pid.get("value"):
        series_id = pid["value"]

    # Type → medium (e.g. "Web Novel", "Light Novel").
    medium = "Web Novel"
    type_tag = soup.select_one("#showtype a") or soup.select_one("#showtype")
    if type_tag:
        type_text = type_tag.get_text(strip=True)
        if "Light Novel" in type_text:
            medium = "Light Novel"

    # Original language → origin.
    origin: Optional[str] = None
    lang_tag = soup.select_one("#showlang a") or soup.select_one("#showlang")
    if lang_tag:
        lang = lang_tag.get_text(strip=True)
        if lang in _LANG_ORIGINS:
            origin = lang

    # Year is shown verbatim in #edityear.
    year: Optional[int] = None
    year_tag = soup.select_one("#edityear")
    if year_tag:
        ym = re.search(r"(\d{4})", year_tag.get_text(strip=True))
        if ym:
            year = int(ym.group(1))

    # #editstatus reads e.g. "2334 Chapters (Completed)" — the leading number is
    # the original-language chapter total.
    total: Optional[int] = None
    status_tag = soup.select_one("#editstatus")
    if status_tag:
        cm = re.search(r"(\d+)\s*Chapter", status_tag.get_text(strip=True))
        if cm:
            total = int(cm.group(1))

    genres: list[str] = []
    for g in soup.select("#seriesgenre a.genre"):
        text = g.get_text(strip=True)
        if text:
            genres.append(text)

    # Overall rating shown as e.g. "4.3 / 5" — normalise to a 0–10 scale.
    external_rating: Optional[float] = None
    rating_match = re.search(r"(\d(?:\.\d+)?)\s*/\s*5", soup.get_text(" ", strip=True))
    if rating_match:
        try:
            external_rating = round(float(rating_match.group(1)) * 2, 1)
        except (TypeError, ValueError):
            external_rating = None

    return SearchResult(
        title=title,
        medium=medium,
        origin=origin,
        year=year,
        cover_url=cover_url,
        total=total,
        external_id=series_id,
        source="novelupdates",
        description=None,
        external_url=f"https://www.novelupdates.com/series/{slug}/",
        genres=", ".join(genres) or None,
        external_rating=external_rating,
    )
