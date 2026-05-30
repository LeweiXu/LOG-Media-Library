"""Scrape a single Qidian (起点中文网) book page into a SearchResult.

The desktop ``book.qidian.com`` / ``www.qidian.com`` pages sit behind an
anti-bot JS probe that serves an empty body to HTTP clients. The mobile page
``m.qidian.com/book/{id}.html`` has no such wall and exposes the same rich
Open Graph ``og:novel:*`` metadata (title, cover, category, description), so we
fetch that and accept either URL form the user might paste.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from schemas import SearchResult
from ._common import fetch_bytes

logger = logging.getLogger(__name__)


def _book_id(url: str) -> Optional[str]:
    # Accept book.qidian.com/info/{id}/, www.qidian.com/book/{id}/,
    # and m.qidian.com/book/{id}.html
    m = re.search(r"/(?:info|book)/(\d+)", url)
    return m.group(1) if m else None


def _meta(soup, prop: str) -> Optional[str]:
    tag = soup.find("meta", attrs={"property": prop})
    if tag:
        content = (tag.get("content") or "").strip()
        return content or None
    return None


def _abs_url(src: Optional[str]) -> Optional[str]:
    if not src:
        return None
    if src.startswith("//"):
        return "https:" + src
    return src


async def _catalog_total_and_year(book_id: str) -> tuple[Optional[int], Optional[int]]:
    """Count chapters and find the start year from the mobile catalog page.

    The book page itself renders its chapter list with JS, but
    ``m.qidian.com/book/{id}/catalog`` is server-rendered: one ``/chapter/``
    link per chapter, each tagged with a publish date. We count the unique
    chapter links and take the earliest year as the publication year.
    """
    from bs4 import BeautifulSoup

    raw = await fetch_bytes(f"https://m.qidian.com/book/{book_id}/catalog")
    if not raw:
        return None, None

    soup = BeautifulSoup(raw, "lxml")
    hrefs = {a.get("href") for a in soup.select('a[href*="/chapter/"]') if a.get("href")}
    total = len(hrefs) or None

    # Earlier chapter dates live in the page's embedded JSON rather than the
    # visible text, so scan the raw HTML; the earliest plausible year is the
    # publication start.
    html = raw.decode("utf-8", "ignore")
    years = [int(y) for y in re.findall(r"(\d{4})-\d{2}-\d{2}", html)]
    years = [y for y in years if 1990 <= y <= 2100]
    year = min(years) if years else None
    return total, year


async def fetch(client, url: str) -> Optional[SearchResult]:
    book_id = _book_id(url)
    if not book_id:
        return None

    raw = await fetch_bytes(f"https://m.qidian.com/book/{book_id}.html")
    if not raw:
        return None

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(raw, "lxml")

    title = _meta(soup, "og:novel:book_name") or _meta(soup, "og:title")
    if not title:
        return None

    cover_url = _abs_url(_meta(soup, "og:image"))
    description = _meta(soup, "og:description")
    category = _meta(soup, "og:novel:category")

    total, year = await _catalog_total_and_year(book_id)

    return SearchResult(
        title=title,
        medium="Web Novel",
        origin="Chinese",
        year=year,
        cover_url=cover_url,
        total=total,
        external_id=book_id,
        source="qidian",
        description=description,
        external_url=f"https://www.qidian.com/book/{book_id}/",
        genres=category,
        external_rating=None,
    )
