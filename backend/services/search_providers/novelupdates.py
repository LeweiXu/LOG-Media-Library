from __future__ import annotations

import asyncio
import copy
import logging
import random
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
    # Keep the page's real cover URL (e.g. /images/2025/07/Title.jpeg). The old
    # /imgmid/<file> rewrite 404s for newer covers and never matches the
    # extension's cover cache key, so it broke both direct display and the
    # cached fallback. Only protocol/root-relative srcs are fixed up above.
    return src


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


def _synopsis_from_box(box) -> Optional[str]:
    """Full series synopsis from a NU listing box.

    The visible first paragraph sits as a bare text node directly inside
    ``.search_body_nu``; the continuation lives in a hidden ``.testhide`` block.
    Reading only ``.testhide`` (as we used to) dropped that first paragraph, so
    take the whole body instead and strip its structural children (title / stats
    / genre sub-blocks) and the "more>>/<<less" toggle controls. Mirrors the
    extension's ``scrapeNuSearchResults`` so direct + fallback fetches agree.
    """
    body = box.select_one(".search_body_nu")
    if not body:
        return None
    clone = copy.copy(body)
    for junk in clone.select(
        ".search_title, .search_stats, .search_genre, .dots, "
        ".morelink, .moreless, span.list, a"
    ):
        junk.extract()
    text = re.sub(r"\s+", " ", clone.get_text(" ", strip=True))
    text = re.sub(r"(more>>|<<\s*less)\s*$", "", text, flags=re.I).strip()
    return text[:800] or None


async def search_novelupdates(
    client,       # httpx.AsyncClient — not used directly; kept for API consistency
    title: str,
    limit: int = 10,
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
            if r.status_code == 403 or r.headers.get("cf-mitigated") == "challenge":
                # NovelUpdates sits behind Cloudflare; if our TLS-impersonated
                # request still gets the "Just a moment…" managed challenge we
                # can't solve it server-side. Surface a clear, distinct warning
                # instead of a generic HTTP error and degrade to no results.
                logger.warning(
                    "NovelUpdates blocked by Cloudflare challenge (HTTP %s) — "
                    "skipping; results unavailable.", r.status_code,
                )
                return []
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "lxml")
        except Exception as exc:
            logger.warning("NovelUpdates fetch/parse error: %s", exc)
            return []

        results: list[SearchResult] = []

        for box in soup.select("div.search_main_box_nu")[:max(1, min(limit, 50))]:
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

            description = _synopsis_from_box(box)
            if not description:
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


_NU_EXPLORE_RANKS = ("week", "month", "popmonth", "sixmonths", "popular")
_NU_EXPLORE_MAX_PAGE = 10
_NU_EXPLORE_CONCURRENCY = 3


def _sample_nu_ranking_pages(seed: Optional[int], count: int) -> list[tuple[str, int]]:
    """Weighted sample of NU ranking pages, biased toward smaller page numbers."""
    rng = random.Random(seed)
    pool: list[tuple[float, str, int]] = []
    for rank in _NU_EXPLORE_RANKS:
        for pg in range(1, _NU_EXPLORE_MAX_PAGE + 1):
            # Exponential-key weighted sampling without replacement. Lower pages
            # have more weight, but every rank/page remains reachable.
            weight = 1 / (pg ** 1.35)
            pool.append((rng.expovariate(weight), rank, pg))
    pool.sort(key=lambda x: x[0])
    return [(rank, pg) for _, rank, pg in pool[:count]]


async def _discover_novelupdates(
    client,
    medium: str,
    page: int = 1,
    *,
    seed: Optional[int] = None,
    target: int = 30,
):
    """Scrape NovelUpdates' Top Series rankings as Explore candidates.

    NU has no public API, so we go through the same Cloudflare-bypass path
    as ``search_novelupdates`` (curl_cffi in a thread, since it's blocking).
    Discovery samples from 5 rank modes × 10 pages with a bias toward lower
    page numbers, then fetches at most three pages concurrently.
    Returns ExploreItems for the Web Novel medium only.
    """
    # Local imports — keep ExploreItem off the search-provider import path.
    from schemas import ExploreItem
    from curl_cffi import requests as cffi_requests
    from bs4 import BeautifulSoup

    if medium != "Web Novel":
        return []

    url = "https://www.novelupdates.com/series-ranking/"
    sample_count = min(50, max(12, (max(target, 1) + 3) // 4))
    candidates = _sample_nu_ranking_pages(seed if seed is not None else page, sample_count)

    def _parse_box(box) -> Optional[ExploreItem]:
        title_tag = box.select_one("div.search_title a")
        if not title_tag:
            return None
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

        description = _synopsis_from_box(box)
        if not description and genres:
            description = "Genres: " + ", ".join(genres)

        return ExploreItem(
            title=display_title,
            medium="Web Novel",
            origin=origin,
            year=year,
            cover_url=cover_url,
            total=chapters,
            external_id=series_id,
            source="novelupdates",
            description=description,
            external_url=series_url,
            genres=", ".join(genres) or None,
            external_rating=external_rating,
        )

    def _do_scrape(rank: str, pg: int) -> list[ExploreItem]:
        try:
            r = cffi_requests.get(
                url, params={"rank": rank, "pg": pg}, timeout=15, impersonate="chrome"
            )
            if r.status_code == 403 or r.headers.get("cf-mitigated") == "challenge":
                logger.warning(
                    "NovelUpdates discover blocked by Cloudflare challenge "
                    "(rank=%s pg=%s HTTP %s) — skipping.", rank, pg, r.status_code,
                )
                return []
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "lxml")
        except Exception as exc:
            logger.warning("NovelUpdates discover fetch/parse error: %s", exc)
            return []

        out: list[ExploreItem] = []

        for box in soup.select("div.search_main_box_nu")[:20]:
            item = _parse_box(box)
            if item:
                out.append(item)

        return out

    async def _fetch_one(rank: str, pg: int) -> list[ExploreItem]:
        async with sem:
            return await loop.run_in_executor(None, _do_scrape, rank, pg)

    loop = asyncio.get_event_loop()
    sem = asyncio.Semaphore(_NU_EXPLORE_CONCURRENCY)
    try:
        groups = await asyncio.gather(
            *(_fetch_one(rank, pg) for rank, pg in candidates),
            return_exceptions=True,
        )
    except Exception as exc:
        logger.warning("NovelUpdates discover executor error: %s", exc)
        return []

    combined: list[ExploreItem] = []
    seen: set[tuple[str, str]] = set()
    for group in groups:
        if isinstance(group, Exception):
            logger.warning("NovelUpdates discover page error: %s", group)
            continue
        for item in group:
            key = (item.title.lower().strip(), item.medium or "")
            if not key[0] or key in seen:
                continue
            seen.add(key)
            combined.append(item)
            if len(combined) >= target:
                return combined
    return combined
