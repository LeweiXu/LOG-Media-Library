#!/usr/bin/env python3
"""
test_novelupdates.py

Standalone test for the NovelUpdates Series Finder scraper.

Usage:
    python test_novelupdates.py                          # default query
    python test_novelupdates.py "Mushoku Tensei"
    python test_novelupdates.py "Omniscient Reader" "Web Novel"

The script has two modes:
  1. LIVE   — actually hits novelupdates.com via cloudscraper
  2. STATIC — parses a locally saved .htm file (no network needed)

Set STATIC_HTML_PATH below to use a saved HTML file, or leave it as None
to go live.
"""

import asyncio
import logging
import re
import sys
from typing import Optional

# ── Configure logging so warnings surface clearly ─────────────────────────────
logging.basicConfig(
    level=logging.DEBUG,
    format="%(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger("test_novelupdates")

# ── Optional: point this at a saved .htm file to test without network ─────────
STATIC_HTML_PATH: Optional[str] = None
# STATIC_HTML_PATH = "/path/to/Series_Finder_-_Novel_Updates.htm"

# ──────────────────────────────────────────────────────────────────────────────

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


def _parse_html(html: str, medium: str) -> list[dict]:
    """
    Parse the Series Finder HTML and return a list of result dicts.
    Mirrors the logic in _search_novelupdates exactly so you can verify
    parsing against any saved HTML without needing the full FastAPI stack.
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    boxes = soup.select("div.search_main_box_nu")
    logger.info("Found %d result box(es) in HTML", len(boxes))

    results = []

    for box in boxes[:8]:

        # Series ID
        addtolist = box.select_one("div.img_addtolist")
        series_id: Optional[str] = None
        if addtolist:
            m = re.search(r"show_rl_genre_nu\('(\d+)'", addtolist.get("onclick", ""))
            if m:
                series_id = m.group(1)

        # Cover image
        img = box.select_one("div.search_img_nu img")
        cover_url: Optional[str] = None
        if img:
            src = img.get("src") or img.get("data-src") or ""
            if src:
                cover_url = src.replace("/imgmid/", "/images/")

        # Title + URL
        title_tag = box.select_one("div.search_title a")
        if not title_tag:
            logger.warning("Skipping box — no title anchor found")
            continue
        display_title = title_tag.get_text(strip=True)
        series_url = title_tag.get("href") or None

        # Stats
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

        # Genres
        genres: list[str] = [
            a.get_text(strip=True)
            for a in box.select("a.gennew.search")
        ]

        # Origin
        origin: Optional[str] = None
        genres_lower = " ".join(genres).lower()
        for hint, orig in _NU_ORIGIN_HINTS.items():
            if hint in genres_lower:
                origin = orig
                break

        # Medium
        if medium:
            med_resolved = medium
        elif origin == "Japanese":
            med_resolved = "Light Novel"
        else:
            med_resolved = "Web Novel"

        # Year (best-effort from last_updated)
        year: Optional[int] = None
        if last_updated:
            m = re.search(r"(\d{4})$", last_updated)
            if m:
                year = int(m.group(1))

        results.append({
            "series_id":   series_id,
            "title":       display_title,
            "medium":      med_resolved,
            "origin":      origin,
            "year":        year,
            "cover_url":   cover_url,
            "chapters":    chapters,
            "last_updated":last_updated,
            "genres":      genres,
            "series_url":  series_url,
        })

    return results


def _fetch_live(query: str) -> str:
    """Fetch live HTML from NovelUpdates Series Finder via curl_cffi."""
    from curl_cffi import requests as cffi_requests

    url = "https://www.novelupdates.com/series-finder/"
    params = {"sf": "1", "sh": query, "sort": "sdate", "order": "desc"}

    logger.info("Fetching: %s?%s", url, "&".join(f"{k}={v}" for k, v in params.items()))
    r = cffi_requests.get(url, params=params, timeout=15, impersonate="chrome")
    logger.info("HTTP %d  (%d bytes)", r.status_code, len(r.content))
    r.raise_for_status()
    return r.text


def _print_results(results: list[dict], query: str) -> None:
    print(f"\n{'='*60}")
    print(f"NovelUpdates results for: '{query}'")
    print(f"{'='*60}")

    if not results:
        print("  ✗  No results found (or page structure changed / Cloudflare blocked)")
        return

    for i, r in enumerate(results, 1):
        print(f"\n[{i}] {r['title']}")
        print(f"     ID       : {r['series_id']}")
        print(f"     Medium   : {r['medium']}")
        print(f"     Origin   : {r['origin'] or '(unknown)'}")
        print(f"     Year     : {r['year'] or '(not available)'}")
        print(f"     Chapters : {r['chapters'] or '(unknown)'}")
        print(f"     Updated  : {r['last_updated'] or '(unknown)'}")
        print(f"     Genres   : {', '.join(r['genres']) or '(none)'}")
        print(f"     Cover    : {r['cover_url'] or '(none)'}")
        print(f"     URL      : {r['series_url'] or '(none)'}")


def main() -> None:
    query  = sys.argv[1] if len(sys.argv) > 1 else "The Legend of Sun Knight"
    medium = sys.argv[2] if len(sys.argv) > 2 else ""

    print(f"Query : '{query}'")
    print(f"Medium: '{medium or '(any)'}'")

    if STATIC_HTML_PATH:
        print(f"\n[MODE] Static — reading from: {STATIC_HTML_PATH}")
        with open(STATIC_HTML_PATH, encoding="utf-8") as f:
            html = f.read()
    else:
        print("\n[MODE] Live — fetching from novelupdates.com …")
        try:
            html = _fetch_live(query)
        except Exception as exc:
            logger.error("Failed to fetch page: %s", exc)
            print("\n✗ Fetch failed. Try setting STATIC_HTML_PATH to a saved .htm file.")
            sys.exit(1)

    results = _parse_html(html, medium)
    _print_results(results, query)

    # Quick sanity assertions (won't fail the script, just warn)
    print(f"\n{'─'*60}")
    print("Sanity checks:")
    checks = [
        ("At least 1 result",        len(results) >= 1),
        ("First result has title",   bool(results and results[0]["title"])),
        ("First result has cover",   bool(results and results[0]["cover_url"])),
        ("Cover uses /images/ CDN",  bool(results and results[0]["cover_url"]
                                         and "/images/" in results[0]["cover_url"])),
        ("First result has chapters",bool(results and results[0]["chapters"] is not None)),
        ("First result has genres",  bool(results and results[0]["genres"])),
        ("First result has URL",     bool(results and results[0]["series_url"])),
        ("URL contains novelupdates",bool(results and results[0]["series_url"]
                                         and "novelupdates.com" in results[0]["series_url"])),
    ]
    all_passed = True
    for label, passed in checks:
        status = "✓" if passed else "✗"
        print(f"  {status}  {label}")
        if not passed:
            all_passed = False

    print(f"\n{'All checks passed ✓' if all_passed else 'Some checks failed ✗'}")


if __name__ == "__main__":
    main()