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
from datetime import datetime
from typing import Optional

import httpx
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from constants import VALID_MEDIUMS
from models import Entry, ExploreCache
from schemas import ExploreItem, ExploreResponse, AffinitySnapshot
from services.search_providers.utils import (
    settings, country_to_origin, safe_year, TIMEOUT,
)
from services.search_providers.tmdb import _TMDB_GENRE_NAMES
from services.search_providers.novelupdates import discover_novelupdates

logger = logging.getLogger(__name__)


VALID_EXPLORE_BY = {"all", "genre", "medium", "origin"}


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
# Each returns up to ~20 ExploreItems for a given medium hint. They all
# silently return [] when their API key / endpoint is unavailable.

async def _discover_tmdb(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    api_key = settings.TMDB_API_KEY
    if not api_key or medium not in ("Film", "TV Show"):
        return []
    tmdb_type = "movie" if medium == "Film" else "tv"
    try:
        r = await client.get(
            f"https://api.themoviedb.org/3/trending/{tmdb_type}/week",
            params={"api_key": api_key, "page": page},
        )
        r.raise_for_status()
    except Exception as exc:
        logger.warning("TMDB trending error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json().get("results", [])[:20]:
        item_id = str(item.get("id") or "")
        if not item_id:
            continue
        poster = item.get("poster_path")
        cover = f"https://image.tmdb.org/t/p/w780{poster}" if poster else None
        gids = item.get("genre_ids") or []
        genres_str = ", ".join(_TMDB_GENRE_NAMES[g] for g in gids if g in _TMDB_GENRE_NAMES) or None
        vote = item.get("vote_average")
        out.append(ExploreItem(
            title=item.get("title") or item.get("name") or "",
            medium=medium,
            year=safe_year(item.get("release_date") or item.get("first_air_date")),
            cover_url=cover,
            external_id=item_id,
            source="tmdb",
            description=(item.get("overview") or "")[:200] or None,
            external_url=f"https://www.themoviedb.org/{tmdb_type}/{item_id}",
            genres=genres_str,
            external_rating=round(float(vote), 1) if vote else None,
        ))
    return out


_ANILIST_TRENDING = """
query ($type: MediaType, $perPage: Int!, $page: Int!) {
  Page(page: $page, perPage: $perPage) {
    media(type: $type, sort: TRENDING_DESC, isAdult: false) {
      id
      title { english romaji native }
      type format episodes chapters
      startDate { year }
      coverImage { extraLarge large }
      countryOfOrigin
      description(asHtml: false)
      genres
      averageScore
    }
  }
}
"""

_ANILIST_FORMAT_TO_MEDIUM = {
    "TV": "Anime", "TV_SHORT": "Anime", "MOVIE": "Anime",
    "SPECIAL": "Anime", "OVA": "Anime", "ONA": "Anime", "MUSIC": "Anime",
    "MANGA": "Manga", "NOVEL": "Light Novel", "ONE_SHOT": "Manga",
}


async def _discover_anilist(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    if medium not in ("Anime", "Manga", "Light Novel"):
        return []
    media_type = "ANIME" if medium == "Anime" else "MANGA"
    try:
        r = await client.post(
            "https://graphql.anilist.co",
            json={"query": _ANILIST_TRENDING, "variables": {"type": media_type, "perPage": 30, "page": page}},
        )
        r.raise_for_status()
    except Exception as exc:
        logger.warning("AniList trending error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json().get("data", {}).get("Page", {}).get("media", []):
        t = item.get("title") or {}
        display = t.get("english") or t.get("romaji") or t.get("native") or ""
        fmt = item.get("format") or ""
        med = _ANILIST_FORMAT_TO_MEDIUM.get(fmt, "Anime" if media_type == "ANIME" else "Manga")
        # Filter to the requested medium when possible (Light Novel vs Manga from AniList NOVEL format)
        if medium == "Light Novel" and med != "Light Novel":
            continue
        if medium == "Manga" and med == "Light Novel":
            continue
        if medium == "Anime" and med != "Anime":
            continue
        anilist_id = str(item.get("id") or "")
        cover_img = item.get("coverImage") or {}
        cover = cover_img.get("extraLarge") or cover_img.get("large")
        score = item.get("averageScore")
        out.append(ExploreItem(
            title=display,
            medium=med,
            origin=country_to_origin(item.get("countryOfOrigin")),
            year=(item.get("startDate") or {}).get("year"),
            cover_url=cover,
            total=item.get("episodes") or item.get("chapters"),
            external_id=anilist_id,
            source="anilist",
            description=(item.get("description") or "")[:200] or None,
            external_url=f"https://anilist.co/{'anime' if media_type == 'ANIME' else 'manga'}/{anilist_id}",
            genres=", ".join((item.get("genres") or [])[:5]) or None,
            external_rating=round(score / 10, 1) if score else None,
        ))
    return out


async def _discover_jikan(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    """Jikan top anime / top manga — no API key required."""
    if medium not in ("Anime", "Manga"):
        return []
    endpoint = f"https://api.jikan.moe/v4/top/{'anime' if medium == 'Anime' else 'manga'}"
    try:
        r = await client.get(endpoint, params={"limit": 25, "filter": "bypopularity", "page": page})
        r.raise_for_status()
    except Exception as exc:
        logger.warning("Jikan top error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json().get("data", []):
        titles = item.get("titles") or []
        display = next((t["title"] for t in titles if t.get("type") == "English"), None) or item.get("title") or ""
        images = item.get("images") or {}
        jpg = images.get("jpg") or {}
        webp = images.get("webp") or {}
        cover = (
            webp.get("large_image_url") or jpg.get("large_image_url")
            or webp.get("image_url")    or jpg.get("image_url")
        )
        mal_id = str(item.get("mal_id") or "")
        aired = item.get("aired") or item.get("published") or {}
        prop = (aired.get("prop") or {}).get("from") or {}
        year = prop.get("year") or safe_year((aired.get("from") or "")[:10] or None)
        type_field = (item.get("type") or "").lower()
        med = "Light Novel" if (medium == "Manga" and "novel" in type_field) else medium
        score = item.get("score")
        out.append(ExploreItem(
            title=display,
            medium=med,
            origin="Japanese",
            year=year,
            cover_url=cover,
            total=item.get("episodes") or item.get("chapters"),
            external_id=mal_id,
            source="jikan",
            description=(item.get("synopsis") or "")[:200] or None,
            external_url=f"https://myanimelist.net/{'anime' if medium == 'Anime' else 'manga'}/{mal_id}",
            genres=", ".join(g["name"] for g in (item.get("genres") or [])[:5] if g.get("name")) or None,
            external_rating=round(float(score), 1) if score else None,
        ))
    return out


async def _igdb_token(client: httpx.AsyncClient) -> Optional[str]:
    cid, csecret = settings.IGDB_CLIENT_ID, settings.IGDB_CLIENT_SECRET
    if not cid or not csecret:
        return None
    try:
        r = await client.post(
            "https://id.twitch.tv/oauth2/token",
            params={"client_id": cid, "client_secret": csecret, "grant_type": "client_credentials"},
        )
        r.raise_for_status()
        return r.json().get("access_token")
    except Exception as exc:
        logger.warning("IGDB token error: %s", exc)
        return None


async def _discover_igdb(client: httpx.AsyncClient, medium: str, page: int = 1) -> list[ExploreItem]:
    if medium != "Game":
        return []
    cid = settings.IGDB_CLIENT_ID
    if not cid:
        return []
    token = await _igdb_token(client)
    if not token:
        return []
    # Games released in the last ~3 years, ordered by total rating count (popularity).
    cutoff = int(datetime.utcnow().timestamp()) - (3 * 365 * 86400)
    offset = max(0, (page - 1) * 25)
    try:
        r = await client.post(
            "https://api.igdb.com/v4/games",
            headers={"Client-ID": cid, "Authorization": f"Bearer {token}"},
            content=(
                f"fields name,first_release_date,cover.image_id,"
                f"summary,url,genres.name,rating,total_rating_count; "
                f"where first_release_date > {cutoff} & cover != null & total_rating_count > 25; "
                f"sort total_rating_count desc; "
                f"limit 25; offset {offset};"
            ),
        )
        r.raise_for_status()
    except Exception as exc:
        logger.warning("IGDB discover error: %s", exc)
        return []

    out: list[ExploreItem] = []
    for item in r.json():
        cover = item.get("cover") or {}
        image_id = cover.get("image_id")
        cover_url = (
            f"https://images.igdb.com/igdb/image/upload/t_cover_big_2x/{image_id}.jpg"
            if image_id else None
        )
        ts = item.get("first_release_date")
        year = datetime.fromtimestamp(ts).year if ts else None
        rating = item.get("rating")
        out.append(ExploreItem(
            title=item.get("name") or "",
            medium="Game",
            year=year,
            cover_url=cover_url,
            external_id=str(item.get("id") or ""),
            source="igdb",
            description=(item.get("summary") or "")[:200] or None,
            external_url=item.get("url"),
            genres=", ".join(g["name"] for g in (item.get("genres") or [])[:5] if g.get("name")) or None,
            external_rating=round(rating / 10, 1) if rating else None,
        ))
    return out


async def _discover_google_books(
    client: httpx.AsyncClient, medium: str, top_genres: list[str], page: int = 1,
) -> list[ExploreItem]:
    """Google Books has no global "popular" feed; use the user's most-consumed
    genres as subject hints, falling back to a generic bestseller query."""
    if medium != "Book":
        return []
    queries = [f"subject:{g}" for g in top_genres[:2]] or ["subject:fiction"]
    out: list[ExploreItem] = []
    start_index = max(0, (page - 1) * 20)
    for q in queries:
        try:
            params = {"q": q, "orderBy": "relevance", "maxResults": 20,
                      "printType": "books", "startIndex": start_index}
            api_key = settings.GOOGLE_BOOKS_API_KEY
            if api_key:
                params["key"] = api_key
            r = await client.get("https://www.googleapis.com/books/v1/volumes", params=params)
            r.raise_for_status()
        except Exception as exc:
            logger.warning("Google Books discover error: %s", exc)
            continue
        for item in r.json().get("items", []):
            info = item.get("volumeInfo") or {}
            ext_id = item.get("id") or ""
            year = safe_year(info.get("publishedDate"))
            cover = (info.get("imageLinks") or {}).get("thumbnail")
            if cover and cover.startswith("http://"):
                cover = "https://" + cover[len("http://"):]
            avg = info.get("averageRating")
            out.append(ExploreItem(
                title=info.get("title") or "",
                medium="Book",
                year=year,
                cover_url=cover,
                external_id=ext_id,
                source="google_books",
                description=(info.get("description") or "")[:200] or None,
                external_url=info.get("infoLink") or info.get("previewLink"),
                genres=", ".join((info.get("categories") or [])[:3]) or None,
                external_rating=round(float(avg) * 2, 1) if avg else None,  # 5-scale → 10-scale
            ))
    return out


_PROVIDER_FNS_BY_MEDIUM: dict[str, list] = {
    "Film":         [_discover_tmdb],
    "TV Show":      [_discover_tmdb],
    "Anime":        [_discover_jikan, _discover_anilist],
    "Manga":        [_discover_jikan, _discover_anilist],
    "Light Novel":  [_discover_anilist],
    "Web Novel":    [discover_novelupdates],    # scrapes NU rankings
    "Book":         [_discover_google_books],   # special-cased — needs top_genres
    "Game":         [_discover_igdb],
}


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

_BIAS_CAP_GENRE  = 1.6
_BIAS_CAP_MEDIUM = 1.2
_BIAS_CAP_ORIGIN = 1.2
# Used when explore_by == "all" — three smaller biases combined.
_BIAS_CAP_ALL_GENRE  = 0.7
_BIAS_CAP_ALL_MEDIUM = 0.5
_BIAS_CAP_ALL_ORIGIN = 0.5
_JITTER_AMPLITUDE    = 1.5


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
            mediums_to_query = ["Anime", "Film", "TV Show", "Game", "Book"]

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
        for med in mediums_to_query:
            for fn in _PROVIDER_FNS_BY_MEDIUM.get(med, []):
                # Vary the upstream page per call so refresh actually pulls
                # different titles instead of just reshuffling the same 20.
                page = rng.randint(1, 3)
                if fn is _discover_google_books:
                    tasks.append(fn(client, med, top_genre_names, page))
                else:
                    tasks.append(fn(client, med, page))
        groups = await asyncio.gather(*tasks, return_exceptions=True)

    combined: list[ExploreItem] = []
    for g in groups:
        if isinstance(g, Exception):
            logger.warning("Explore provider exception: %s", g)
            continue
        combined.extend(g)

    # Deduplicate by (lowered title, medium) — keep the entry with the best
    # external_rating as the canonical one.
    best: dict[tuple[str, str], ExploreItem] = {}
    for item in combined:
        if not item.title:
            continue
        key = (item.title.lower().strip(), item.medium or "")
        cur = best.get(key)
        if cur is None or (item.external_rating or 0) > (cur.external_rating or 0):
            if cur is not None:
                if not item.cover_url and cur.cover_url:
                    item.cover_url = cur.cover_url
                if not item.genres and cur.genres:
                    item.genres = cur.genres
            best[key] = item
    items = list(best.values())

    has_data = profile.sample_size > 0
    bias_active = has_data and (gcap or mcap or ocap)

    def ranked_key(item: ExploreItem) -> float:
        # Center popularity around 5/10 so a 7-rated item gets +2 and an
        # unrated item is neutral.
        pop = (item.external_rating or 5.0) - 5.0
        bias = 0.0
        if bias_active:
            if gcap:
                bias += _genre_bias(item, genre_weights, gcap)
            if mcap:
                bias += _scalar_bias(item.medium, medium_weights, mcap)
            if ocap:
                bias += _scalar_bias(item.origin, origin_weights, ocap)
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
    existing = db.execute(
        select(func.lower(Entry.title), Entry.medium)
        .where(Entry.username == username)
    ).all()
    owned = {(t, m or "") for t, m in existing}
    filtered = [
        i for i in items
        if (i.title.lower().strip(), i.medium or "") not in owned
    ]

    for i in filtered:
        i.matches = profile.matches(i)

    return ExploreResponse(
        items        = filtered[:limit],
        affinity     = profile.snapshot(),
        personalised = profile.sample_size > 0,
    )
