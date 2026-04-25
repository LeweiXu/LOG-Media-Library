"""
Explore service — surfaces new media and ranks it against the user's taste.

Pipeline
────────
1.  Build an *affinity profile* from the user's rated entries:
      - per-genre, per-origin, per-medium signed score
      - score = mean(rating - user_mean_rating) * sqrt(count)
        (Bayesian-ish weighting so a single 9/10 doesn't outrank a genre
         with five 7/10s).
2.  Fan out to discovery endpoints across providers in parallel; each one
    returns recently-popular / trending picks. Mediums are chosen either
    explicitly via the request, or by descending affinity (when "all").
3.  Drop titles already in the user's library when `hide_in_library`.
4.  Rank by 50% raw popularity + 50% affinity. Without affinity (cold
    start) fall back to popularity alone.
5.  Tag each item with up to two "match_genres" — the genres it shares
    with the user's top-affinity genres. Used by the UI for a *subtle*
    "matches: action, drama" hint, not aggressive recommendations.

Discovery providers live inline below — they hit known popular/trending
endpoints rather than reusing the title-search code paths.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
from collections import defaultdict
from datetime import datetime
from typing import Optional

import httpx
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from constants import VALID_MEDIUMS
from models import Entry
from schemas import ExploreItem, ExploreResponse, AffinitySnapshot
from services.search_providers.utils import (
    settings, country_to_origin, safe_year, TIMEOUT,
)
from services.search_providers.tmdb import _TMDB_GENRE_NAMES

logger = logging.getLogger(__name__)


# ── Affinity profile ──────────────────────────────────────────────────────────

# Keep computed affinity for a moment to avoid recomputing on every page change
# during a single browsing session. Tiny TTL — we want fresh data after edits.
_AFFINITY_TTL_S = 60
_affinity_cache: dict[str, tuple[float, "Affinity"]] = {}


class Affinity:
    """Signed-score lookup tables built from one user's rated entries."""

    __slots__ = ("genres", "origins", "mediums", "sample_size", "_g_top")

    def __init__(
        self,
        genres:   dict[str, float],
        origins:  dict[str, float],
        mediums:  dict[str, float],
        sample:   int,
    ) -> None:
        self.genres      = genres
        self.origins     = origins
        self.mediums     = mediums
        self.sample_size = sample
        # Pre-compute top genres (with positive scores) for the "matches" tag.
        self._g_top = {
            k for k, v in
            sorted(genres.items(), key=lambda kv: kv[1], reverse=True)[:8]
            if v > 0
        }

    def candidate_score(self, item: ExploreItem) -> float:
        """Return blended popularity + affinity score for ranking."""
        # Center popularity around 5/10 so a 7-rated item gets +2 and an
        # unrated item is neutral.
        pop = (item.external_rating or 5.0) - 5.0

        if self.sample_size == 0:
            return pop

        # Genre overlap — average score across the candidate's listed genres.
        g_score = 0.0
        if item.genres:
            cg = [g.strip() for g in item.genres.split(",") if g.strip()]
            if cg:
                g_score = sum(self.genres.get(g, 0.0) for g in cg) / len(cg)

        o_score = self.origins.get(item.origin, 0.0) if item.origin else 0.0
        m_score = self.mediums.get(item.medium, 0.0) if item.medium else 0.0

        # Genre is the strongest signal, then origin, then medium.
        affinity = 0.55 * g_score + 0.25 * o_score + 0.20 * m_score
        return 0.5 * pop + 0.5 * affinity

    def match_genres(self, item: ExploreItem) -> list[str]:
        if not item.genres or not self._g_top:
            return []
        cg = [g.strip() for g in item.genres.split(",") if g.strip()]
        return [g for g in cg if g in self._g_top][:2]

    def snapshot(self) -> AffinitySnapshot:
        def top(d: dict[str, float], n: int) -> list[str]:
            return [
                k for k, v in
                sorted(d.items(), key=lambda kv: kv[1], reverse=True)[:n]
                if v > 0
            ]
        return AffinitySnapshot(
            sample_size = self.sample_size,
            top_genres  = top(self.genres,  5),
            top_origins = top(self.origins, 3),
            top_mediums = top(self.mediums, 3),
        )


def _build_affinity(db: Session, username: str) -> Affinity:
    """Compute the affinity profile from rated entries (current/completed/on_hold/dropped all count)."""
    rows = db.execute(
        select(Entry).where(
            Entry.username == username,
            Entry.rating.is_not(None),
        )
    ).scalars().all()

    if not rows:
        return Affinity({}, {}, {}, 0)

    user_mean = sum(e.rating for e in rows) / len(rows)

    genre_deltas:  dict[str, list[float]] = defaultdict(list)
    origin_deltas: dict[str, list[float]] = defaultdict(list)
    medium_deltas: dict[str, list[float]] = defaultdict(list)

    for e in rows:
        delta = e.rating - user_mean
        if e.genres:
            for g in (g.strip() for g in e.genres.split(",")):
                if g:
                    genre_deltas[g].append(delta)
        if e.origin:
            origin_deltas[e.origin].append(delta)
        if e.medium:
            medium_deltas[e.medium].append(delta)

    def reduce(d: dict[str, list[float]]) -> dict[str, float]:
        # mean delta * sqrt(n) — shrinks single-sample outliers, rewards
        # consistently rated categories.
        return {
            k: (sum(v) / len(v)) * math.sqrt(len(v))
            for k, v in d.items()
        }

    return Affinity(
        genres  = reduce(genre_deltas),
        origins = reduce(origin_deltas),
        mediums = reduce(medium_deltas),
        sample  = len(rows),
    )


def _get_affinity(db: Session, username: str) -> Affinity:
    import time
    now = time.monotonic()
    cached = _affinity_cache.get(username)
    if cached and (now - cached[0]) < _AFFINITY_TTL_S:
        return cached[1]
    affinity = _build_affinity(db, username)
    _affinity_cache[username] = (now, affinity)
    return affinity


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
    """Google Books has no global "popular" feed; use the user's top affinity
    genres as subject hints, falling back to a generic bestseller query."""
    if medium != "Book":
        return []
    # Prefer the user's top affinity genres; otherwise generic
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
            isbns = info.get("industryIdentifiers") or []
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
    "Book":         [_discover_google_books],   # special-cased — needs top_genres
    "Game":         [_discover_igdb],
}


# ── Main entry point ──────────────────────────────────────────────────────────

async def explore_media(
    db: Session,
    *,
    username:        str,
    medium:          Optional[str] = None,
    personalize:     bool = True,
    hide_in_library: bool = True,
    limit:           int  = 40,
    seed:            Optional[int] = None,
) -> ExploreResponse:
    """Return ranked explore items + the user's affinity snapshot.

    ``seed`` controls the per-call shuffle. With no seed, results are
    deterministic (best for caching / testing). The frontend passes a fresh
    random seed on every refresh so the user sees a different mix each time
    while strong affinity picks still tend to surface near the top.
    """

    rng = random.Random(seed) if seed is not None else random.Random()

    affinity = _get_affinity(db, username)

    # Decide which mediums to fetch.
    if medium and medium in VALID_MEDIUMS:
        mediums_to_query = [medium]
    else:
        # When "all": prefer mediums the user has positive affinity for, else
        # round-robin a sensible default mix.
        if affinity.sample_size > 0:
            ranked = sorted(affinity.mediums.items(), key=lambda kv: kv[1], reverse=True)
            mediums_to_query = [m for m, s in ranked if s > 0][:3]
        else:
            mediums_to_query = []
        if not mediums_to_query:
            mediums_to_query = ["Anime", "Film", "TV Show", "Game", "Book"]

    top_genres_for_books = [
        k for k, v in
        sorted(affinity.genres.items(), key=lambda kv: kv[1], reverse=True)
        if v > 0
    ][:5]

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        tasks = []
        for med in mediums_to_query:
            for fn in _PROVIDER_FNS_BY_MEDIUM.get(med, []):
                # Vary the upstream page per call so refresh actually pulls
                # different titles instead of just reshuffling the same 20.
                page = rng.randint(1, 3)
                if fn is _discover_google_books:
                    tasks.append(fn(client, med, top_genres_for_books, page))
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
    # external_rating as the canonical one (covers vary between sources but
    # rating is more reliable as a tiebreaker than source priority here).
    best: dict[tuple[str, str], ExploreItem] = {}
    for item in combined:
        if not item.title:
            continue
        key = (item.title.lower().strip(), item.medium or "")
        cur = best.get(key)
        if cur is None or (item.external_rating or 0) > (cur.external_rating or 0):
            # Borrow cover_url / genres if the new item is missing them
            if cur is not None:
                if not item.cover_url and cur.cover_url:
                    item.cover_url = cur.cover_url
                if not item.genres and cur.genres:
                    item.genres = cur.genres
            best[key] = item
    items = list(best.values())

    # Drop items already in the user's library.
    if hide_in_library:
        existing = db.execute(
            select(func.lower(Entry.title), Entry.medium)
            .where(Entry.username == username)
        ).all()
        owned = {(t, m or "") for t, m in existing}
        items = [i for i in items if (i.title.lower().strip(), i.medium or "") not in owned]
    else:
        # Still tag in_library for the UI even if we don't filter.
        existing = db.execute(
            select(func.lower(Entry.title), Entry.medium)
            .where(Entry.username == username)
        ).all()
        owned = {(t, m or "") for t, m in existing}
        for i in items:
            if (i.title.lower().strip(), i.medium or "") in owned:
                i.in_library = True

    # Tag match_genres + rank with seeded jitter so refresh produces variety.
    for i in items:
        i.match_genres = affinity.match_genres(i)

    use_affinity = personalize and affinity.sample_size > 0
    # Jitter is a fraction of the typical score scale (~5–10 pts) so it
    # nudges the order without burying strong affinity matches.
    jitter_amplitude = 1.5

    def ranked_key(item: ExploreItem) -> float:
        base = (
            affinity.candidate_score(item) if use_affinity
            else (item.external_rating or 0)
        )
        return base + rng.uniform(-jitter_amplitude, jitter_amplitude)

    # Pre-shuffle the pool first so providers don't bias the jittered sort
    # toward whichever one returned its results first.
    rng.shuffle(items)
    items.sort(key=ranked_key, reverse=True)

    return ExploreResponse(
        items        = items[:limit],
        affinity     = affinity.snapshot(),
        personalised = use_affinity,
    )
