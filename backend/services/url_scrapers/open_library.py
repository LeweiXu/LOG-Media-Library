"""Resolve an Open Library work URL into a SearchResult via the Open Library API.

Open Library's work record only reliably carries title, cover and description;
year/page-count live on individual editions, so those are left blank for the
user to fill (the keyword-search path still provides them).
"""
from __future__ import annotations

import re
from typing import Optional

from schemas import SearchResult


async def fetch(client, url: str) -> Optional[SearchResult]:
    m = re.search(r"/works/(OL\d+W)", url)
    if not m:
        return None
    olid = m.group(1)

    try:
        r = await client.get(f"https://openlibrary.org/works/{olid}.json")
        r.raise_for_status()
        d = r.json()
    except Exception:
        return None

    title = d.get("title")
    if not title:
        return None

    covers = d.get("covers") or []
    cover = f"https://covers.openlibrary.org/b/id/{covers[0]}-L.jpg" if covers else None
    desc = d.get("description")
    if isinstance(desc, dict):
        desc = desc.get("value")

    return SearchResult(
        title=title,
        medium="Book",
        origin=None,
        year=None,
        cover_url=cover,
        total=None,
        external_id=olid,
        source="open_library",
        description=desc or None,
        external_url=f"https://openlibrary.org/works/{olid}",
        genres=None,
    )
