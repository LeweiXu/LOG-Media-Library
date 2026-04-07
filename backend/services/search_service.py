"""
External media search service.

Strategy:
  - Route the query to the specified source provider, or fan out to all providers if no source given.
  - Results are normalised to SearchResult before being returned.
  - Any provider that fails is silently skipped so a partial result is always returned.
  - All providers are optional — if no API key is configured the provider is skipped.

Source → Provider mapping:
  tmdb          → TMDB (Film & TV)
  anilist       → AniList (Anime & Manga)
  jikan         → MyAnimeList via Jikan (Anime & Manga)
  kitsu         → Kitsu (Anime & Manga)
  novelupdates  → NovelUpdates (Web Novel, Light Novel)
  mangadex      → MangaDex (Manga, Comics)
  igdb          → IGDB (Games)
  rawg          → RAWG (Games)
  google_books  → Google Books
  open_library  → Open Library
  comicvine     → ComicVine (Comics)

Keys required (all optional — provider is skipped if absent):
  TMDB_API_KEY
  IGDB_CLIENT_ID + IGDB_CLIENT_SECRET
  GOOGLE_BOOKS_API_KEY
  RAWG_API_KEY
  COMICVINE_API_KEY

No-key providers (always active):
  AniList, Jikan (MAL proxy), MangaDex, Kitsu, Open Library
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

import httpx

from schemas import SearchResult
from services.search_providers import (
    search_tmdb,
    search_anilist,
    search_jikan,
    search_kitsu,
    search_mangadex,
    search_igdb,
    search_rawg,
    search_google_books,
    search_open_library,
    search_comicvine,
    search_mangaupdates,
    search_novelupdates,
)
from services.search_providers.utils import TIMEOUT

logger = logging.getLogger(__name__)

# ── Deduplication & ranking ───────────────────────────────────────────────────

# Provider preference order when two results look like duplicates.
# Lower index = higher trust for cover quality / metadata completeness.
_SOURCE_PRIORITY = [
    "novelupdates", # best web novel metadata, highly curated
    "tmdb",         # best film/TV metadata
    "igdb",         # best game metadata
    "jikan",        # MAL data — preferred over AniList for anime & manga
    "mangaupdates", # best manga metadata, highly curated
    "anilist",      # good anime/manga, lower priority than Jikan/MangaUpdates
    "kitsu",        # decent fallback for anime/manga
    "mangadex",     # great for manga, cover quality varies
    "google_books",
    "open_library",
    "comicvine",
    "rawg",
]


def _source_rank(source: str) -> int:
    try:
        return _SOURCE_PRIORITY.index(source)
    except ValueError:
        return len(_SOURCE_PRIORITY)


def _deduplicate_and_rank(
    combined: list[SearchResult], query: str
) -> list[SearchResult]:
    """
    1. Group near-duplicate titles (same normalised title + medium).
    2. Within each group keep the entry from the highest-priority source,
       but steal a better cover_url from a lower-priority source if the
       primary source has none.
    3. Sort final list: exact title matches first, then by source priority.
    """
    groups: dict[tuple[str, str], list[SearchResult]] = defaultdict(list)
    for r in combined:
        key = (r.title.lower().strip(), r.medium)
        groups[key].append(r)

    deduped: list[SearchResult] = []
    for items in groups.values():
        items.sort(key=lambda x: _source_rank(x.source))
        best = items[0]
        patch: dict = {}
        # Borrow cover_url and genres from lower-priority sources if missing
        need_cover  = not best.cover_url
        need_genres = not best.genres
        for fallback in items[1:]:
            if need_cover and fallback.cover_url:
                patch["cover_url"] = fallback.cover_url
                need_cover = False
            if need_genres and fallback.genres:
                patch["genres"] = fallback.genres
                need_genres = False
            if not need_cover and not need_genres:
                break
        if patch:
            best = SearchResult(**{**best.model_dump(), **patch})
        deduped.append(best)

    # Sort: exact title match first, then source priority
    q_lower = query.lower()
    deduped.sort(
        key=lambda r: (
            0 if r.title.lower() == q_lower else 1,
            _source_rank(r.source),
        )
    )
    return deduped


# ── Public interface ──────────────────────────────────────────────────────────

_ALL_PROVIDERS = [
    search_tmdb,
    search_anilist,
    search_jikan,
    search_kitsu,
    search_novelupdates,
    # search_mangaupdates,
    search_mangadex,
    search_igdb,
    search_rawg,
    search_google_books,
    search_open_library,
    search_comicvine,
]

_SOURCE_TO_PROVIDER = {
    "tmdb":         search_tmdb,
    "anilist":      search_anilist,
    "jikan":        search_jikan,
    "kitsu":        search_kitsu,
    "novelupdates": search_novelupdates,
    "mangadex":     search_mangadex,
    "mangaupdates": search_mangaupdates,
    "igdb":         search_igdb,
    "rawg":         search_rawg,
    "google_books": search_google_books,
    "open_library": search_open_library,
    "comicvine":    search_comicvine,
}


async def search_media(title: str, source: str = "") -> list[SearchResult]:
    """
    Fan-out search across all providers (or a single source) in parallel.
    Results are de-duplicated, ranked, and capped at 10.
    """
    if source:
        providers = [_SOURCE_TO_PROVIDER[source]] if source in _SOURCE_TO_PROVIDER else _ALL_PROVIDERS
    else:
        providers = _ALL_PROVIDERS

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        tasks = [p(client, title) for p in providers]
        groups = await asyncio.gather(*tasks, return_exceptions=True)

    combined: list[SearchResult] = []
    for group in groups:
        if isinstance(group, Exception):
            logger.warning("Search provider exception: %s", group)
            continue
        combined.extend(group)

    return _deduplicate_and_rank(combined, title)[:10]
