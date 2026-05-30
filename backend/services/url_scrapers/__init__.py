"""URL-based single-page scrapers for no-API media sites.

Each module exposes ``async def fetch(client, url) -> SearchResult | None``.
``DOMAIN_SCRAPERS`` maps a domain substring to its scraper; the import service
picks the first entry whose key appears in the pasted URL's host. To add a site,
drop in a module and register its domain here.
"""
from __future__ import annotations

from . import novelupdates, jjwxc, qidian, imdb

DOMAIN_SCRAPERS = {
    "novelupdates.com": novelupdates.fetch,
    "jjwxc.net":        jjwxc.fetch,
    "qidian.com":       qidian.fetch,
    "imdb.com":         imdb.fetch,
}

__all__ = ["DOMAIN_SCRAPERS"]
