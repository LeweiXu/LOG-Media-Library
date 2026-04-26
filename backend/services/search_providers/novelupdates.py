from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional
from urllib.parse import urlparse

from schemas import SearchResult

logger = logging.getLogger(__name__)

_NU_ORIGIN_MAP = {
    "CN": "Chinese",
    "KR": "Korean",
    "JP": "Japanese",
}


def _normalise_cover_url(src: str) -> Optional[str]:
    if not src:
        return None
    if src.startswith("//"):
        src = "https:" + src
    if src.startswith("/"):
        src = "https://cdn.novelupdates.com" + src
    if "cdn.novelupdates.com/imgmid/" in src:
        return src
    filename = src.rstrip("/").split("/")[-1]
    if filename:
        return f"https://cdn.novelupdates.com/imgmid/{filename}"
    return None


def _genre_from_href(href: str) -> Optional[str]:
    path = urlparse(href).path.strip("/")
    parts = path.split("/")
    if len(parts) < 2 or parts[-2] != "genre":
        return None
    slug = parts[-1]
    return " ".join(word.capitalize() for word in slug.split("-") if word)


def _external_rating_from_text(text: str) -> Optional[float]:
    match = re.search(r"\((\d+(?:\.\d+)?)\)", text)
    if not match:
        return None
    try:
        return round(float(match.group(1)) * 2, 1)
    except (TypeError, ValueError):
        return None


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
      - origin (from NU language code)
      - external rating (normalised from NovelUpdates 0-5 to 0-10)
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
                cover_url = _normalise_cover_url(src)

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

            genres: list[str] = []
            for genre_link in box.select(".search_genre a[href]"):
                genre = _genre_from_href(genre_link.get("href", ""))
                if genre:
                    genres.append(genre)

            origin_code = box.select_one(".search_ratings span")
            origin = _NU_ORIGIN_MAP.get(origin_code.get_text(strip=True).upper()) if origin_code else None
            ratings_box = box.select_one(".search_ratings")
            external_rating = _external_rating_from_text(ratings_box.get_text(" ", strip=True)) if ratings_box else None

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
                    medium="Web Novel",
                    origin=origin,
                    year=year,
                    cover_url=cover_url,
                    total=chapters,
                    external_id=series_id or "",
                    source="novelupdates",
                    description=description,
                    external_url=series_url,
                    genres=", ".join(genres) or None,
                    external_rating=external_rating,
                )
            )

        return results

    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _do_scrape)
    except Exception as exc:
        logger.warning("NovelUpdates executor error: %s", exc)
        return []


# Page index → which "Top Series" ranking URL to scrape. Cycling these on
# Refresh gives the user a different mix instead of the same 25 titles.
_NU_RANK_BY_PAGE = {1: "popmonth", 2: "sixmonths", 3: "popular"}


async def _discover_novelupdates(client, medium: str, page: int = 1):
    """Scrape NovelUpdates' Top Series rankings as Explore candidates.

    NU has no public API, so we go through the same Cloudflare-bypass path
    as ``search_novelupdates`` (curl_cffi in a thread, since it's blocking).
    Returns ExploreItems for the Web Novel medium only.
    """
    # Local imports — keep ExploreItem off the search-provider import path.
    from schemas import ExploreItem
    from curl_cffi import requests as cffi_requests
    from bs4 import BeautifulSoup

    if medium != "Web Novel":
        return []

    rank = _NU_RANK_BY_PAGE.get(page, "popmonth")
    url = "https://www.novelupdates.com/series-ranking/"
    params = {"rank": rank}

    def _do_scrape() -> list[ExploreItem]:
        try:
            r = cffi_requests.get(url, params=params, timeout=15, impersonate="chrome")
            r.raise_for_status()
        except Exception as exc:
            logger.warning("NovelUpdates discover fetch error: %s", exc)
            return []

        soup = BeautifulSoup(r.text, "lxml")
        out: list[ExploreItem] = []

        for box in soup.select("div.search_main_box_nu")[:20]:
            title_tag = box.select_one("div.search_title a")
            if not title_tag:
                continue
            display_title = title_tag.get_text(strip=True)
            series_url = title_tag.get("href") or None

            sid_span = box.select_one('span.rl_icons_en[id^="sid"]')
            series_id = sid_span.get("id", "")[3:] if sid_span else ""
            if not series_id and series_url:
                series_id = series_url.rstrip("/").split("/")[-1]

            img = box.select_one("div.search_img_nu img")
            cover_url: Optional[str] = None
            if img:
                src = img.get("src") or img.get("data-src") or ""
                cover_url = _normalise_cover_url(src)

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

            genres: list[str] = []
            for genre_link in box.select(".search_genre a[href*='/genre/']"):
                g = _genre_from_href(genre_link.get("href", ""))
                if g:
                    genres.append(g)

            origin_code = box.select_one(".search_ratings span")
            origin = (
                _NU_ORIGIN_MAP.get(origin_code.get_text(strip=True).upper())
                if origin_code else None
            )
            ratings_box = box.select_one(".search_ratings")
            external_rating = (
                _external_rating_from_text(ratings_box.get_text(" ", strip=True))
                if ratings_box else None
            )

            year: Optional[int] = None
            if last_updated:
                m = re.search(r"(\d{4})$", last_updated)
                if m:
                    year = int(m.group(1))

            out.append(ExploreItem(
                title=display_title,
                medium="Web Novel",
                origin=origin,
                year=year,
                cover_url=cover_url,
                total=chapters,
                external_id=series_id,
                source="novelupdates",
                description=("Genres: " + ", ".join(genres)) if genres else None,
                external_url=series_url,
                genres=", ".join(genres) or None,
                external_rating=external_rating,
            ))

        return out

    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, _do_scrape)
    except Exception as exc:
        logger.warning("NovelUpdates discover executor error: %s", exc)
        return []
