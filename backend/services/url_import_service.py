"""Fetch a single entry's details from a pasted media-page URL.

Counterpart to ``search_service`` for the no-API sites: instead of fanning out
a keyword query, it routes one URL to the matching site scraper. Best-effort —
an unrecognised domain or any scrape failure yields ``[]`` so the UI can fall
back to manual entry rather than erroring.
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

import httpx

from schemas import SearchResult
from services.search_providers.utils import TIMEOUT
from services.url_scrapers import DOMAIN_SCRAPERS

logger = logging.getLogger(__name__)


def _scraper_for(url: str):
    """Return the scraper whose registered domain appears in the URL's host."""
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return None
    for domain, scraper in DOMAIN_SCRAPERS.items():
        if host == domain or host.endswith("." + domain):
            return scraper
    return None


async def fetch_from_url(url: str) -> list[SearchResult]:
    url = (url or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return []

    scraper = _scraper_for(url)
    if scraper is None:
        return []

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            result = await scraper(client, url)
    except Exception:
        logger.exception("URL scrape failed for %s", url)
        return []

    # A scraper may resolve a page to one entry or many (e.g. a Goodreads series
    # page → one result per book). Flatten either shape to a list.
    if not result:
        return []
    return result if isinstance(result, list) else [result]
