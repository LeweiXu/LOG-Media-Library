"""
Explore service — surfaces new media and biases ranking toward whichever
dimension the user picked in Settings (``explore_by``).

Pipeline
────────
1.  Build a *consumption profile* by counting how often each genre / origin /
    medium appears in the user's library. Counts only — no rating math.
2.  Pick the dimension to bias on from ``explore_by``:
      - "genre"  → bias toward titles whose genres overlap with the user's
                   most-consumed genres
      - "medium" → bias toward titles in the user's most-consumed mediums
      - "origin" → bias toward titles in the user's most-consumed origins
      - "all"    → small mixed bias from all three
3.  Fan out to discovery endpoints across providers in parallel; each one
    returns recently-popular / trending picks. Mediums are chosen either
    explicitly via the request, or by descending consumption when "all".
4.  Drop titles already in the user's library (always — the toggle was
    retired in favour of an always-on filter).
5.  Rank by ``popularity + bias`` with seeded jitter so "Refresh" actually
    reshuffles the result instead of returning the same order.
6.  Tag each item with up to two ``matches`` — items the candidate shares
    with the user's most-consumed genres / origins / mediums. Used by the
    UI for a *subtle* "matches: action, japanese" hint.

Caching
───────
Results are cached per ``(username, medium)`` in the ``explore_cache`` table.
Only the Refresh button on the Explore page invalidates a cache row — every
other request reads from cache (re-filtering library titles live so that
adding an entry on one tab doesn't show stale "available" items on another).

Discovery providers live inline below — they hit known popular/trending
endpoints rather than reusing the title-search code paths.
"""
from __future__ import annotations

import asyncio
import json
import logging
import random
from collections import Counter
from typing import Optional

import httpx
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from constants import VALID_MEDIUMS
from models import Entry, ExploreCache
from schemas import ExploreItem, ExploreResponse, AffinitySnapshot
from services.search_providers.utils import TIMEOUT
from services.search_providers.anilist import _discover_anilist
from services.search_providers.comicvine import _discover_comicvine
from services.search_providers.google_books import _discover_google_books
from services.search_providers.igdb import _discover_igdb
from services.search_providers.jikan import _discover_jikan
from services.search_providers.novelupdates import _discover_novelupdates
from services.search_providers.rawg import _discover_rawg
from services.search_providers.tmdb import _discover_tmdb
from services.search_providers.vndb import _discover_vndb

logger = logging.getLogger(__name__)


VALID_EXPLORE_BY = {"all", "genre", "medium", "origin"}
_MIN_RECOMMENDATIONS_PER_MEDIUM = 30
_MAX_DISCOVERY_PAGES_PER_PROVIDER = 10


# ── Consumption profile ───────────────────────────────────────────────────────

# Cache the per-user counts briefly to avoid re-querying on every page change
# during a single browsing session. Tiny TTL — fresh after edits.
_PROFILE_TTL_S = 60
_profile_cache: dict[str, tuple[float, "ConsumptionProfile"]] = {}


class ConsumptionProfile:
    """Counts of genres / origins / mediums across the user's entries."""

    __slots__ = (
        "genres", "origins", "mediums", "sample_size",
        "_g_top", "_o_top", "_m_top",
    )

    def __init__(
        self,
        genres:  Counter[str],
        origins: Counter[str],
        mediums: Counter[str],
        sample:  int,
    ) -> None:
        self.genres      = genres
        self.origins     = origins
        self.mediums     = mediums
        self.sample_size = sample
        # Pre-compute the top items in each dimension for the "matches" hint.
        self._g_top = {g for g, _ in genres.most_common(8)}
        self._o_top = {o for o, _ in origins.most_common(3)}
        self._m_top = {m for m, _ in mediums.most_common(3)}

    def snapshot(self) -> AffinitySnapshot:
        return AffinitySnapshot(
            sample_size = self.sample_size,
            top_genres  = [g for g, _ in self.genres.most_common(5)],
            top_origins = [o for o, _ in self.origins.most_common(3)],
            top_mediums = [m for m, _ in self.mediums.most_common(3)],
        )

    def matches(self, item: ExploreItem) -> list[str]:
        """Mixed list of genres / origin / medium that overlap with the user's
        most-consumed values across all three dimensions."""
        out: list[str] = []
        if item.genres and self._g_top:
            for g in (g.strip() for g in item.genres.split(",") if g.strip()):
                if g in self._g_top and g not in out:
                    out.append(g)
        if item.origin and item.origin in self._o_top and item.origin not in out:
            out.append(item.origin)
        if item.medium and item.medium in self._m_top and item.medium not in out:
            out.append(item.medium)
        return out[:4]


def _build_profile(db: Session, username: str) -> ConsumptionProfile:
    """Count each dimension across all of the user's entries (no rating filter)."""
    rows = db.execute(
        select(Entry.genres, Entry.origin, Entry.medium)
        .where(Entry.username == username)
    ).all()

    genre_counts:  Counter[str] = Counter()
    origin_counts: Counter[str] = Counter()
    medium_counts: Counter[str] = Counter()

    for genres, origin, medium in rows:
        if genres:
            for g in (g.strip() for g in genres.split(",")):
                if g:
                    genre_counts[g] += 1
        if origin:
            origin_counts[origin] += 1
        if medium:
            medium_counts[medium] += 1

    return ConsumptionProfile(
        genres=genre_counts, origins=origin_counts,
        mediums=medium_counts, sample=len(rows),
    )


def _get_profile(db: Session, username: str) -> ConsumptionProfile:
    import time
    now = time.monotonic()
    cached = _profile_cache.get(username)
    if cached and (now - cached[0]) < _PROFILE_TTL_S:
        return cached[1]
    profile = _build_profile(db, username)
    _profile_cache[username] = (now, profile)
    return profile


def _normalised_weights(counter: Counter[str], top_n: int = 10) -> dict[str, float]:
    """Return a dict mapping the top-N keys to a 0..1 weight (max-normalised)."""
    if not counter:
        return {}
    top = counter.most_common(top_n)
    max_count = top[0][1] or 1
    return {k: c / max_count for k, c in top}


# ── Discovery providers ───────────────────────────────────────────────────────
# Provider implementations live in services/search_providers/*.py. The Explore
# service only owns provider ordering, fallback, cache, filtering, and ranking.

_PROVIDER_FNS_BY_MEDIUM: dict[str, list] = {
    "Film":         [_discover_tmdb],
    "TV Show":      [_discover_tmdb],
    "Anime":        [_discover_jikan, _discover_anilist],
    "Manga":        [_discover_jikan, _discover_anilist],
    "Light Novel":  [_discover_jikan, _discover_anilist],
    "Web Novel":    [_discover_novelupdates],    # scrapes NU rankings
    "Comic":        [_discover_comicvine],
    "Book":         [_discover_google_books],   # special-cased — needs top_genres
    "Game":         [_discover_rawg, _discover_igdb],
    "Visual Novel": [_discover_vndb],
}


async def _call_discover_provider(
    fn,
    client: httpx.AsyncClient,
    medium: str,
    top_genres: list[str],
    page: int,
) -> list[ExploreItem]:
    if fn is _discover_google_books:
        return await fn(client, medium, top_genres, page)
    return await fn(client, medium, page)


def _item_key(item: ExploreItem) -> tuple[str, str]:
    return (item.title.lower().strip(), item.medium or "")


def _dedupe_best(items: list[ExploreItem]) -> list[ExploreItem]:
    """Deduplicate by (lowered title, medium), keeping the best-rated copy."""
    best: dict[tuple[str, str], ExploreItem] = {}
    for item in items:
        if not item.title:
            continue
        key = _item_key(item)
        cur = best.get(key)
        if cur is None or (item.external_rating or 0) > (cur.external_rating or 0):
            if cur is not None:
                if not item.cover_url and cur.cover_url:
                    item.cover_url = cur.cover_url
                if not item.genres and cur.genres:
                    item.genres = cur.genres
            best[key] = item
    return list(best.values())


def _visible_count(items: list[ExploreItem], owned: set[tuple[str, str]]) -> int:
    return sum(1 for item in _dedupe_best(items) if _item_key(item) not in owned)


async def _discover_medium_with_fallback(
    client: httpx.AsyncClient,
    medium: str,
    top_genres: list[str],
    rng: random.Random,
    target_visible: int,
    owned: set[tuple[str, str]],
) -> list[ExploreItem]:
    """Try providers by priority, querying more pages until enough items exist.

    A fallback provider is only used when the higher-priority provider returns
    nothing useful or cannot fill the remaining visible recommendations after
    several pages.
    """
    combined: list[ExploreItem] = []
    for fn in _PROVIDER_FNS_BY_MEDIUM.get(medium, []):
        pages = list(range(1, _MAX_DISCOVERY_PAGES_PER_PROVIDER + 1))
        rng.shuffle(pages)

        for page in pages:
            try:
                items = await _call_discover_provider(fn, client, medium, top_genres, page)
            except Exception as exc:
                logger.warning("Explore provider exception for %s: %s", medium, exc)
                break

            if not items:
                continue

            combined.extend(items)

            if _visible_count(combined, owned) >= target_visible:
                return _dedupe_best(combined)

    return _dedupe_best(combined)


# ── Bias scoring ──────────────────────────────────────────────────────────────
#
# Bias is intentionally gentle — just enough to nudge the user's preferred
# dimension toward the top without burying random recommendations. The ranking
# formula is:  popularity_centered + bias_amount + jitter.
#
# Popularity is centered around 5.0 so it spans ~[-5, +5]. Bias amounts are
# capped at the constants below; jitter is wider than bias so a popular
# unrelated title can still beat a low-popularity match. This keeps the page
# feeling *exploratory* rather than predictable.

_BIAS_CAP_GENRE  = 0.8
_BIAS_CAP_MEDIUM = 0.5
_BIAS_CAP_ORIGIN = 0.5
# Used when explore_by == "all" — three smaller biases combined.
_BIAS_CAP_ALL_GENRE  = 0.35
_BIAS_CAP_ALL_MEDIUM = 0.25
_BIAS_CAP_ALL_ORIGIN = 0.25
_JITTER_AMPLITUDE    = 2.4
_BIAS_MATCH_THRESHOLD = 0.25


def _genre_bias(item: ExploreItem, weights: dict[str, float], cap: float) -> float:
    if not item.genres or not weights:
        return 0.0
    cg = [g.strip() for g in item.genres.split(",") if g.strip()]
    if not cg:
        return 0.0
    score = sum(weights.get(g, 0.0) for g in cg) / len(cg)
    return score * cap


def _scalar_bias(value: Optional[str], weights: dict[str, float], cap: float) -> float:
    if not value or not weights:
        return 0.0
    return weights.get(value, 0.0) * cap


# ── Per-(user, medium) result cache ───────────────────────────────────────────
#
# Stored in the ``explore_cache`` table. We only refresh on an explicit
# request from the frontend (the Refresh button on the Explore page); every
# other read returns the cached payload, after re-applying the live "in
# library" filter so adding an entry on one tab doesn't leave it visible on
# another.

def _cache_key(medium: Optional[str]) -> str:
    """Normalise a medium hint into the string used as the cache key.

    Empty string is the cache key for the "All" sidebar tab.
    """
    return medium or ""


def _read_cache(db: Session, username: str, medium: Optional[str]) -> Optional[list[ExploreItem]]:
    row = db.execute(
        select(ExploreCache.items_json).where(
            ExploreCache.username == username,
            ExploreCache.medium   == _cache_key(medium),
        )
    ).first()
    if not row:
        return None
    try:
        raw = json.loads(row[0])
        return [ExploreItem(**d) for d in raw]
    except Exception as exc:
        logger.warning("Discarding malformed explore cache row: %s", exc)
        return None


def _write_cache(db: Session, username: str, medium: Optional[str], items: list[ExploreItem]) -> None:
    payload = json.dumps([i.model_dump() for i in items])
    key = _cache_key(medium)
    existing = db.execute(
        select(ExploreCache).where(
            ExploreCache.username == username,
            ExploreCache.medium   == key,
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(ExploreCache(username=username, medium=key, items_json=payload))
    else:
        existing.items_json = payload
    db.commit()


def _owned_entry_keys(db: Session, username: str) -> set[tuple[str, str]]:
    existing = db.execute(
        select(func.lower(Entry.title), Entry.medium)
        .where(Entry.username == username)
    ).all()
    return {(t, m or "") for t, m in existing}


# ── Main entry point ──────────────────────────────────────────────────────────

async def explore_media(
    db: Session,
    *,
    username:   str,
    medium:     Optional[str] = None,
    explore_by: str           = "all",
    limit:      int           = 40,
    seed:       Optional[int] = None,
    refresh:    bool          = False,
) -> ExploreResponse:
    """Return ranked explore items + a snapshot of the user's top consumed
    genres / origins / mediums.

    Caching: results are cached per ``(username, medium)``. ``refresh=True``
    forces a fresh fetch and overwrites the cache; otherwise a cache hit
    short-circuits the upstream API calls entirely.
    """

    if explore_by not in VALID_EXPLORE_BY:
        explore_by = "all"

    profile = _get_profile(db, username)
    target_limit = max(limit, _MIN_RECOMMENDATIONS_PER_MEDIUM)
    owned = _owned_entry_keys(db, username)

    if not refresh:
        cached = _read_cache(db, username, medium)
        if cached is not None:
            return _finalise(db, username, profile, cached, limit)

    rng = random.Random(seed) if seed is not None else random.Random()

    # Decide which mediums to fetch.
    if medium and medium in VALID_MEDIUMS:
        mediums_to_query = [medium]
    else:
        # When "all": prefer mediums the user already consumes, else a
        # sensible default mix.
        if profile.mediums:
            mediums_to_query = [m for m, _ in profile.mediums.most_common(3)]
        else:
            mediums_to_query = []
        if not mediums_to_query:
            mediums_to_query = [
                "Anime", "Manga", "Film", "TV Show", "Game", "Book",
                "Light Novel", "Web Novel", "Comic", "Visual Novel",
            ]

    top_genre_names = [g for g, _ in profile.genres.most_common(5)]

    # Pre-compute weighted dicts used by the bias scorers.
    genre_weights  = _normalised_weights(profile.genres)
    medium_weights = _normalised_weights(profile.mediums)
    origin_weights = _normalised_weights(profile.origins)

    if explore_by == "genre":
        gcap, mcap, ocap = _BIAS_CAP_GENRE, 0.0, 0.0
    elif explore_by == "medium":
        gcap, mcap, ocap = 0.0, _BIAS_CAP_MEDIUM, 0.0
    elif explore_by == "origin":
        gcap, mcap, ocap = 0.0, 0.0, _BIAS_CAP_ORIGIN
    else:  # "all"
        gcap = _BIAS_CAP_ALL_GENRE
        mcap = _BIAS_CAP_ALL_MEDIUM
        ocap = _BIAS_CAP_ALL_ORIGIN

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        tasks = []
        target_per_medium = (
            target_limit
            if len(mediums_to_query) == 1
            else max(8, target_limit // max(len(mediums_to_query), 1))
        )
        for med in mediums_to_query:
            medium_rng = random.Random(rng.randint(0, 2**31 - 1))
            tasks.append(
                _discover_medium_with_fallback(
                    client, med, top_genre_names, medium_rng, target_per_medium, owned
                )
            )
        groups = await asyncio.gather(*tasks, return_exceptions=True)

    combined: list[ExploreItem] = []
    for g in groups:
        if isinstance(g, Exception):
            logger.warning("Explore provider exception: %s", g)
            continue
        combined.extend(g)

    items = _dedupe_best(combined)

    has_data = profile.sample_size > 0
    bias_active = has_data and (gcap or mcap or ocap)

    def bias_value(item: ExploreItem) -> float:
        bias = 0.0
        if bias_active:
            if gcap:
                bias += _genre_bias(item, genre_weights, gcap)
            if mcap:
                bias += _scalar_bias(item.medium, medium_weights, mcap)
            if ocap:
                bias += _scalar_bias(item.origin, origin_weights, ocap)
        return bias

    for item in items:
        item.bias_matched = bias_value(item) >= _BIAS_MATCH_THRESHOLD

    def ranked_key(item: ExploreItem) -> float:
        # Center popularity around 5/10 so a 7-rated item gets +2 and an
        # unrated item is neutral.
        pop = (item.external_rating or 5.0) - 5.0
        bias = bias_value(item)
        return pop + bias + rng.uniform(-_JITTER_AMPLITUDE, _JITTER_AMPLITUDE)

    # Pre-shuffle so providers don't bias the jittered sort toward whichever
    # one returned its results first.
    rng.shuffle(items)
    items.sort(key=ranked_key, reverse=True)

    # Persist the freshly-ranked list. ``matches`` and ``in_library`` are
    # re-applied at read time, so we strip them before caching to keep the
    # row small and avoid serving stale "in library" tags.
    to_cache = [i.model_copy(update={"matches": [], "in_library": False}) for i in items]
    _write_cache(db, username, medium, to_cache)

    return _finalise(db, username, profile, items, limit)


def _finalise(
    db:       Session,
    username: str,
    profile:  ConsumptionProfile,
    items:    list[ExploreItem],
    limit:    int,
) -> ExploreResponse:
    """Apply the live "in library" filter, tag matches, and trim to ``limit``.

    Used both for cache hits and freshly-fetched results so behaviour stays
    consistent.
    """
    owned = _owned_entry_keys(db, username)
    filtered = [
        i for i in items
        if _item_key(i) not in owned
    ]

    for i in filtered:
        i.matches = profile.matches(i) if i.bias_matched else []

    return ExploreResponse(
        items        = filtered[:limit],
        affinity     = profile.snapshot(),
        personalised = profile.sample_size > 0,
    )
