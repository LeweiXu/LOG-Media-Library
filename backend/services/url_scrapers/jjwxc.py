"""Scrape a single jjwxc (晋江文学城) novel page into a SearchResult.

jjwxc has no API and serves GB-encoded markup with no Open Graph tags, so we
parse defensively: the ``<title>`` carries the book name + author, the synopsis
lives in ``#novelintro``, and the cover is a ``novelimage``/``novelcover`` image.
Any field we can't find is simply left blank for the user to fill in.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from schemas import SearchResult
from ._common import fetch_bytes

logger = logging.getLogger(__name__)


def _novel_id(url: str) -> Optional[str]:
    # onebook.php?novelid=1234567  (also tolerate &novelid= mid-query)
    m = re.search(r"[?&]novelid=(\d+)", url)
    return m.group(1) if m else None


async def fetch(client, url: str) -> Optional[SearchResult]:
    novel_id = _novel_id(url)
    if not novel_id:
        return None

    raw = await fetch_bytes(
        "https://www.jjwxc.net/onebook.php", params={"novelid": novel_id}
    )
    if not raw:
        return None

    from bs4 import BeautifulSoup

    # jjwxc serves GB18030 (GBK superset) without a usable charset hint.
    soup = BeautifulSoup(raw, "lxml", from_encoding="gb18030")

    # Title + author come from the <title>: "《书名》作者：penname_晋江文学城"
    title: Optional[str] = None
    title_tag = soup.find("title")
    if title_tag:
        text = title_tag.get_text(strip=True)
        m = re.search(r"《(.+?)》", text)
        if m:
            title = m.group(1).strip()
    # Fallback to the itemprop name span jjwxc puts in the page header.
    if not title:
        name_span = soup.find(attrs={"itemprop": "name"})
        if name_span:
            title = name_span.get_text(strip=True) or None
    if not title:
        return None

    # Synopsis: jjwxc uses id="novelintro" (itemprop="description").
    description: Optional[str] = None
    intro = soup.find(id="novelintro")
    if intro:
        description = intro.get_text(" ", strip=True) or None

    # Cover: the novel image lives on jjwxc's image CDN.
    cover_url: Optional[str] = None
    for img in soup.find_all("img"):
        src = img.get("src") or img.get("dynamicsrc") or ""
        if "novelimage" in src or "novelcover" in src:
            cover_url = "https:" + src if src.startswith("//") else src
            break

    # The chapter table (#oneboolt) has one row per chapter and a publish date
    # per row; count the rows for the total and take the earliest year as start.
    total: Optional[int] = None
    year: Optional[int] = None
    table = soup.select_one("#oneboolt")
    if table:
        rows = table.select('tr[itemprop="chapter"]')
        if rows:
            total = len(rows)
        years = [int(y) for y in re.findall(r"(\d{4})-\d{2}-\d{2}", table.get_text(" ", strip=True))]
        years = [y for y in years if 1990 <= y <= 2100]
        if years:
            year = min(years)

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
        genres=None,
        external_rating=None,
    )
