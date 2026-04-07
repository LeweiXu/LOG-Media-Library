from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

from schemas import SearchResult

logger = logging.getLogger(__name__)

_NU_ORIGIN_HINTS = {
    "wuxia": "Chinese",
    "xianxia": "Chinese",
    "xuanhuan": "Chinese",
    "manhua": "Chinese",
    "chinese": "Chinese",
    "manhwa": "Korean",
    "korean": "Korean",
    "shounen": "Japanese",
    "shoujo": "Japanese",
    "josei": "Japanese",
    "seinen": "Japanese",
}


async def search_novelupdates(
    client,       # httpx.AsyncClient — not used directly; kept for API consistency
    title: str,
) -> list[SearchResult]:
    """
    Scrape NovelUpdates Series Finder for the given title query.

    Targeted fields per result:
      - title, series URL (external_url)
      - cover image (full-resolution CDN URL)
      - chapter count (total)
      - last updated date (stored as a string in description for now; NU
        doesn't expose a year, only a date like "07-01-2024")
      - genres (stored joined in description and available as metadata)
      - series ID (external_id)
      - origin (inferred from genre tags)
    """
    from curl_cffi import requests as cffi_requests
    from bs4 import BeautifulSoup

    search_url = "https://www.novelupdates.com/series-finder/"
    params = {
        "sf": "1",
        "sh": title,
        "sort": "sdate",
        "order": "desc",
    }

    def _do_scrape() -> list[SearchResult]:
        try:
            r = cffi_requests.get(
                search_url, params=params, timeout=12, impersonate="chrome"
            )
            r.raise_for_status()
        except Exception as exc:
            logger.warning("NovelUpdates fetch error: %s", exc)
            return []

        soup = BeautifulSoup(r.text, "lxml")
        results: list[SearchResult] = []

        for box in soup.select("div.search_main_box_nu")[:8]:
            addtolist = box.select_one("div.img_addtolist")
            series_id: Optional[str] = None
            if addtolist:
                m = re.search(r"show_rl_genre_nu\('(\d+)'", addtolist.get("onclick", ""))
                if m:
                    series_id = m.group(1)

            img = box.select_one("div.search_img_nu img")
            cover_url: Optional[str] = None
            if img:
                src = img.get("src") or img.get("data-src") or ""
                if src:
                    cover_url = src.replace("/imgmid/", "/images/")

            title_tag = box.select_one("div.search_title a")
            if not title_tag:
                continue
            display_title = title_tag.get_text(strip=True)
            series_url = title_tag.get("href") or None

            chapters: Optional[int] = None
            last_updated: Optional[str] = None

            for stat_span in box.select("span.ss_desk"):
                icon = stat_span.select_one("i[title]")
                if not icon:
                    continue
                icon_title = icon.get("title", "")
                stat_text = stat_span.get_text(strip=True)

                if icon_title == "Chapter Count":
                    m = re.search(r"(\d+)", stat_text)
                    if m:
                        chapters = int(m.group(1))
                elif icon_title == "Last Updated":
                    m = re.search(r"(\d{2}-\d{2}-\d{4})", stat_text)
                    if m:
                        last_updated = m.group(1)

            genres: list[str] = [
                a.get_text(strip=True)
                for a in box.select("a.gennew.search")
            ]

            origin: Optional[str] = None
            genres_lower = " ".join(genres).lower()
            for hint, orig in _NU_ORIGIN_HINTS.items():
                if hint in genres_lower:
                    origin = orig
                    break

            if origin == "Japanese":
                med_resolved = "Light Novel"
            else:
                med_resolved = "Web Novel"

            year: Optional[int] = None
            if last_updated:
                m = re.search(r"(\d{4})$", last_updated)
                if m:
                    year = int(m.group(1))

            desc_parts = []
            if genres:
                desc_parts.append("Genres: " + ", ".join(genres))
            if last_updated:
                desc_parts.append(f"Last updated: {last_updated}")
            description = " | ".join(desc_parts) or None

            results.append(
                SearchResult(
                    title=display_title,
                    medium=med_resolved,
                    origin=origin,
                    year=year,
                    cover_url=cover_url,
                    total=chapters,
                    external_id=series_id or "",
                    source="novelupdates",
                    description=description,
                    external_url=series_url,
                )
            )

        return results

    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _do_scrape)
    except Exception as exc:
        logger.warning("NovelUpdates executor error: %s", exc)
        return []
