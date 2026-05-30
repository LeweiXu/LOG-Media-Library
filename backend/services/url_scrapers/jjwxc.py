"""Resolve a single jjwxc (晋江文学城) novel URL into a SearchResult.

jjwxc's Android app API (``app.jjwxc.net/androidapi/novelbasicinfo``) returns
clean JSON metadata — title, cover, intro, tags, chapter count, and the
"完结评分" review score — which is far more robust than scraping the GB-encoded
web page. The only field it doesn't expose is the publication year, so we still
read the earliest chapter date off the web page for that (best-effort).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from schemas import SearchResult
from ._common import fetch_bytes

logger = logging.getLogger(__name__)

_BASIC_INFO_URL = "https://app.jjwxc.net/androidapi/novelbasicinfo"


def _novel_id(url: str) -> Optional[str]:
    # onebook.php?novelid=1234567  (also tolerate &novelid= mid-query)
    m = re.search(r"[?&]novelid=(\d+)", url)
    return m.group(1) if m else None


def _to_int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _review_score(text: Optional[str]) -> Optional[float]:
    """"8分" / "8.5分" → 8.0 / 8.5; "暂无" or missing → None."""
    if not text:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", text)
    return float(m.group(1)) if m else None


async def _start_year(novel_id: str) -> Optional[int]:
    """Earliest chapter year from the web page's chapter table (#oneboolt).

    The app API has no publish date, so this stays on the web page — but only
    for the year, so a layout change degrades one field rather than everything.
    """
    raw = await fetch_bytes(
        "https://www.jjwxc.net/onebook.php", params={"novelid": novel_id}
    )
    if not raw:
        return None
    from bs4 import BeautifulSoup

    table = BeautifulSoup(raw, "lxml", from_encoding="gb18030").select_one("#oneboolt")
    if not table:
        return None
    years = [int(y) for y in re.findall(r"(\d{4})-\d{2}-\d{2}", table.get_text(" ", strip=True))]
    years = [y for y in years if 1990 <= y <= 2100]
    return min(years) if years else None


async def fetch(client, url: str) -> Optional[SearchResult]:
    novel_id = _novel_id(url)
    if not novel_id:
        return None

    raw = await fetch_bytes(_BASIC_INFO_URL, params={"novelId": novel_id})
    if not raw:
        return None
    try:
        info = json.loads(raw.decode("utf-8", "ignore"))
    except (ValueError, TypeError):
        return None

    title = (info.get("novelName") or "").strip()
    if not title:
        return None

    cover_url = (info.get("novelCover") or info.get("originalCover") or "").strip() or None
    description = (info.get("novelIntro") or "").strip() or None
    # novelTags is a comma-separated tag list, e.g. "科幻,情有独钟,穿越时空".
    genres = (info.get("novelTags") or "").strip() or None
    total = _to_int(info.get("novelChapterCount"))
    external_rating = _review_score(info.get("novelReviewScore"))
    year = await _start_year(novel_id)

    return SearchResult(
        title=title,
        medium="Web Novel",
        origin="Chinese",
        year=year,
        cover_url=cover_url,
        total=total,
        external_id=novel_id,
        source="jjwxc",
        description=description,
        external_url=f"https://www.jjwxc.net/onebook.php?novelid={novel_id}",
        genres=genres,
        external_rating=external_rating,
    )
