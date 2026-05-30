"""Shared helpers for the URL scrapers.

All target sites (NovelUpdates, jjwxc, qidian, imdb) either sit behind a
Cloudflare/bot wall or simply serve nicer markup to a real browser, so every
scraper goes through ``curl_cffi`` with Chrome impersonation — the same path
already proven by ``search_providers.novelupdates``. ``curl_cffi`` is blocking,
so the request runs in a thread via ``run_in_executor``.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def fetch_bytes(url: str, *, params: Optional[dict] = None, timeout: int = 15) -> Optional[bytes]:
    """GET ``url`` and return the raw response body, or ``None`` on any failure.

    Returns bytes (not text) so GB-encoded sites can be decoded by the caller
    via ``BeautifulSoup(..., from_encoding=...)``.
    """
    from curl_cffi import requests as cffi_requests

    def _do_get() -> Optional[bytes]:
        try:
            r = cffi_requests.get(url, params=params, timeout=timeout, impersonate="chrome")
            r.raise_for_status()
            return r.content
        except Exception as exc:
            logger.warning("URL scrape fetch error for %s: %s", url, exc)
            return None

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _do_get)
