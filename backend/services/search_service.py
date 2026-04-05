"""
External media search service.

Strategy:
  - Route the query to the most relevant provider(s) based on the requested medium.
  - If no medium is given, query all providers in parallel.
  - Results are normalised to SearchResult before being returned.
  - Any provider that fails is silently skipped so a partial result is always returned.
  - All providers are optional — if no API key is configured the provider is skipped.

Provider → Medium mapping:
  Film            → TMDB
  TV Show         → TMDB, Kitsu (for Korean/Asian dramas)
  Anime           → AniList, Jikan (MAL), Kitsu
  Manga           → AniList, Jikan (MAL), MangaDex, Kitsu
  Light Novel     → AniList, Jikan (MAL), MangaDex, Google Books, Open Library
  Web Novel       → MangaDex, Google Books, Open Library
  Comics          → ComicVine, MangaDex
  Book            → Google Books, Open Library
  Game            → IGDB, RAWG

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
import urllib.parse
from datetime import datetime
from typing import Optional

import httpx

from config import get_settings
from schemas import SearchResult

logger = logging.getLogger(__name__)
settings = get_settings()

TIMEOUT = httpx.Timeout(10.0)

# ── Medium groupings ──────────────────────────────────────────────────────────

_FILM_MEDIUMS      = {"Film"}
_TV_MEDIUMS        = {"TV Show"}
_ANIME_MEDIUMS     = {"Anime"}
_MANGA_MEDIUMS     = {"Manga", "Light Novel", "Web Novel", "Comics"}
_LIGHTNOVEL_MEDIUMS= {"Light Novel", "Web Novel"}
_BOOK_MEDIUMS      = {"Book", "Light Novel", "Web Novel"}
_GAME_MEDIUMS      = {"Game"}
_COMIC_MEDIUMS     = {"Comics"}

# ── Origin helpers ────────────────────────────────────────────────────────────

_COUNTRY_TO_ORIGIN: dict[str, str] = {
    "JP": "Japanese",
    "KR": "Korean",
    "CN": "Chinese",
    "TW": "Chinese",
    "HK": "Chinese",
    "US": "Western",
    "GB": "Western",
    "FR": "Western",
    "DE": "Western",
    "AU": "Western",
    "CA": "Western",
}

def _country_to_origin(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    return _COUNTRY_TO_ORIGIN.get(code.upper(), "Other")


def _safe_year(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    try:
        return int(str(date_str)[:4])
    except (ValueError, TypeError):
        return None


def _score(result: SearchResult, query: str) -> tuple[int, int]:
    """
    Primary sort key for deduplication + ranking.
    Returns (exact_match_bonus, has_cover_bonus) — higher is better.
    Exact title matches are surfaced first.
    """
    exact = 1 if result.title.lower() == query.lower() else 0
    cover = 1 if result.cover_url else 0
    return (exact, cover)


# ── TMDB (Films & TV) ─────────────────────────────────────────────────────────

async def _search_tmdb(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    api_key = settings.TMDB_API_KEY
    if not api_key:
        return []

    results: list[SearchResult] = []
    endpoints: list[tuple[str, str]] = []

    if medium in _FILM_MEDIUMS or not medium:
        endpoints.append(("https://api.themoviedb.org/3/search/movie", "Film"))
    if medium in _TV_MEDIUMS or not medium:
        endpoints.append(("https://api.themoviedb.org/3/search/tv", "TV Show"))

    for url, med in endpoints:
        try:
            r = await client.get(
                url,
                params={"api_key": api_key, "query": title, "include_adult": "false"},
            )
            r.raise_for_status()
            for item in r.json().get("results", [])[:5]:
                poster = item.get("poster_path")
                item_id = str(item.get("id", ""))
                tmdb_type = "movie" if med == "Film" else "tv"
                # TMDB w500 is good but w780 is higher quality; original can be huge
                cover = (
                    f"https://image.tmdb.org/t/p/w780{poster}" if poster else None
                )
                results.append(
                    SearchResult(
                        title=item.get("title") or item.get("name", ""),
                        medium=med,
                        origin=None,
                        year=_safe_year(
                            item.get("release_date") or item.get("first_air_date")
                        ),
                        cover_url=cover,
                        external_id=item_id,
                        source="tmdb",
                        description=(item.get("overview") or "")[:200] or None,
                        external_url=f"https://www.themoviedb.org/{tmdb_type}/{item_id}",
                    )
                )
        except Exception as exc:
            logger.warning("TMDB search error: %s", exc)

    return results


# ── AniList (Anime & Manga) ───────────────────────────────────────────────────

_ANILIST_QUERY = """
query ($search: String, $type: MediaType) {
  Page(page: 1, perPage: 8) {
    media(search: $search, type: $type, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      type
      format
      episodes
      chapters
      volumes
      startDate { year }
      coverImage { extraLarge large medium }
      countryOfOrigin
      description(asHtml: false)
    }
  }
}
"""

_ANILIST_FORMAT_TO_MEDIUM: dict[str, str] = {
    "TV": "Anime",
    "TV_SHORT": "Anime",
    "MOVIE": "Anime",        # anime films
    "SPECIAL": "Anime",
    "OVA": "Anime",
    "ONA": "Anime",
    "MUSIC": "Anime",
    "MANGA": "Manga",
    "NOVEL": "Light Novel",
    "ONE_SHOT": "Manga",
}

async def _search_anilist(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    results: list[SearchResult] = []
    types_to_query: list[str] = []

    if medium in _ANIME_MEDIUMS or not medium:
        types_to_query.append("ANIME")
    if medium in _MANGA_MEDIUMS or not medium:
        types_to_query.append("MANGA")

    for media_type in types_to_query:
        try:
            r = await client.post(
                "https://graphql.anilist.co",
                json={
                    "query": _ANILIST_QUERY,
                    "variables": {"search": title, "type": media_type},
                },
            )
            r.raise_for_status()
            items = (
                r.json().get("data", {}).get("Page", {}).get("media", [])
            )
            for item in items:
                t = item.get("title", {})
                display_title = (
                    t.get("english") or t.get("romaji") or t.get("native", "")
                )
                fmt = item.get("format", "")
                med = _ANILIST_FORMAT_TO_MEDIUM.get(fmt, "Anime" if media_type == "ANIME" else "Manga")
                # If the user asked for a specific medium, honour it
                if medium:
                    med = medium
                total = item.get("episodes") or item.get("chapters")
                anilist_id = str(item.get("id", ""))
                anilist_type = "anime" if media_type == "ANIME" else "manga"
                cover_img = item.get("coverImage", {})
                cover = (
                    cover_img.get("extraLarge")
                    or cover_img.get("large")
                    or cover_img.get("medium")
                )
                origin = _country_to_origin(item.get("countryOfOrigin"))
                desc = item.get("description") or ""
                results.append(
                    SearchResult(
                        title=display_title,
                        medium=med,
                        origin=origin,
                        year=item.get("startDate", {}).get("year"),
                        cover_url=cover,
                        total=total,
                        external_id=anilist_id,
                        source="anilist",
                        description=desc[:200] or None,
                        external_url=f"https://anilist.co/{anilist_type}/{anilist_id}",
                    )
                )
        except Exception as exc:
            logger.warning("AniList search error: %s", exc)

    return results


# ── Jikan — unofficial MyAnimeList API (Anime & Manga, no key) ────────────────

async def _search_jikan(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    """
    Jikan v4 is a public MAL proxy — no API key required.
    https://jikan.moe/
    """
    results: list[SearchResult] = []
    endpoints: list[tuple[str, str]] = []

    if medium in _ANIME_MEDIUMS or not medium:
        endpoints.append(("https://api.jikan.moe/v4/anime", "Anime"))
    if medium in _MANGA_MEDIUMS or not medium:
        endpoints.append(("https://api.jikan.moe/v4/manga", "Manga"))

    for url, med in endpoints:
        try:
            r = await client.get(url, params={"q": title, "limit": 5, "sfw": "true"})
            r.raise_for_status()
            for item in r.json().get("data", []):
                titles = item.get("titles", [])
                # prefer English title, fall back to default romaji
                display_title = next(
                    (t["title"] for t in titles if t.get("type") == "English"),
                    None,
                ) or item.get("title", "")
                images = item.get("images", {})
                jpg = images.get("jpg", {})
                webp = images.get("webp", {})
                # webp large_image_url is the highest quality Jikan exposes
                cover = (
                    webp.get("large_image_url")
                    or jpg.get("large_image_url")
                    or webp.get("image_url")
                    or jpg.get("image_url")
                )
                mal_id = str(item.get("mal_id", ""))
                mal_type = "anime" if med == "Anime" else "manga"
                episodes = item.get("episodes") or item.get("chapters")
                # Jikan gives aired.from / published.from for year
                aired = item.get("aired") or item.get("published") or {}
                prop = aired.get("prop", {}).get("from", {})
                year = prop.get("year") or _safe_year(
                    (aired.get("from") or "")[:10] or None
                )
                # Determine medium more precisely for manga-type entries
                mal_type_field = (item.get("type") or "").lower()
                if med == "Manga":
                    if "light novel" in mal_type_field or "novel" in mal_type_field:
                        med = "Light Novel"
                results.append(
                    SearchResult(
                        title=display_title,
                        medium=med,
                        origin="Japanese",
                        year=year,
                        cover_url=cover,
                        total=episodes,
                        external_id=mal_id,
                        source="jikan",
                        description=(item.get("synopsis") or "")[:200] or None,
                        external_url=f"https://myanimelist.net/{mal_type}/{mal_id}",
                    )
                )
        except Exception as exc:
            logger.warning("Jikan search error: %s", exc)

    return results


# ── Kitsu (Anime & Manga, no key) ─────────────────────────────────────────────

async def _search_kitsu(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    """
    Kitsu.io public API — no API key required.
    https://kitsu.docs.apiary.io/
    """
    results: list[SearchResult] = []
    endpoints: list[tuple[str, str]] = []

    if medium in _ANIME_MEDIUMS or not medium:
        endpoints.append(("https://kitsu.app/api/edge/anime", "Anime"))
    if medium in _MANGA_MEDIUMS or not medium:
        endpoints.append(("https://kitsu.app/api/edge/manga", "Manga"))

    headers = {"Accept": "application/vnd.api+json"}

    for url, med in endpoints:
        try:
            r = await client.get(
                url,
                params={"filter[text]": title, "page[limit]": 5},
                headers=headers,
            )
            r.raise_for_status()
            for item in r.json().get("data", []):
                attrs = item.get("attributes", {})
                display_title = (
                    (attrs.get("titles") or {}).get("en")
                    or (attrs.get("titles") or {}).get("en_jp")
                    or attrs.get("canonicalTitle", "")
                )
                poster = attrs.get("posterImage") or {}
                # Kitsu provides original, large, medium, small
                cover = (
                    poster.get("original")
                    or poster.get("large")
                    or poster.get("medium")
                )
                ep_count = attrs.get("episodeCount") or attrs.get("chapterCount")
                started = attrs.get("startDate") or ""
                year = _safe_year(started[:4]) if started else None
                kitsu_id = str(item.get("id", ""))
                kitsu_type = "anime" if med == "Anime" else "manga"
                # Refine medium for manga sub-types
                subtype = (attrs.get("subtype") or "").lower()
                if med == "Manga" and subtype in ("novel",):
                    med = "Light Novel"
                elif med == "Manga" and subtype in ("manhwa",):
                    med = "Comics"
                results.append(
                    SearchResult(
                        title=display_title,
                        medium=med,
                        origin=None,
                        year=year,
                        cover_url=cover,
                        total=ep_count,
                        external_id=kitsu_id,
                        source="kitsu",
                        description=(attrs.get("synopsis") or "")[:200] or None,
                        external_url=f"https://kitsu.app/{kitsu_type}/{attrs.get('slug', kitsu_id)}",
                    )
                )
        except Exception as exc:
            logger.warning("Kitsu search error: %s", exc)

    return results


# ── MangaDex (Manga, Light Novel, Web Novel, Comics) ─────────────────────────

async def _search_mangadex(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    """
    MangaDex public API — no API key required.
    https://api.mangadex.org/docs/
    """
    if medium and medium not in _MANGA_MEDIUMS and medium not in _COMIC_MEDIUMS:
        return []

    # Map our mediums to MangaDex content ratings + original language hints
    # MangaDex "type" field maps: manga/manhwa/manhua/novel/one_shot/doujinshi
    content_types: list[str] = []
    if not medium:
        content_types = ["manga", "manhwa", "manhua", "novel"]
    elif medium in {"Manga", "Light Novel", "Web Novel"}:
        content_types = ["manga", "manhwa", "manhua", "novel"]
    elif medium in {"Comics"}:
        content_types = ["manga", "manhwa", "manhua"]

    try:
        r = await client.get(
            "https://api.mangadex.org/manga",
            params={
                "title": title,
                "limit": 8,
                "includes[]": ["cover_art", "author"],
                "contentRating[]": ["safe", "suggestive"],
                "order[relevance]": "desc",
            },
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("data", []):
            attrs = item.get("attributes", {})
            titles_dict = attrs.get("title", {})
            # Prefer English title
            display_title = (
                titles_dict.get("en")
                or next(iter(titles_dict.values()), "")
            )
            # Resolve cover_art relationship
            cover_url: Optional[str] = None
            for rel in item.get("relationships", []):
                if rel.get("type") == "cover_art":
                    filename = (rel.get("attributes") or {}).get("fileName")
                    if filename:
                        # MangaDex cover sizes: .512.jpg = 512px, .256.jpg = 256px
                        cover_url = (
                            f"https://uploads.mangadex.org/covers/{item['id']}/{filename}.512.jpg"
                        )
                    break
            pub_year = attrs.get("year")
            chapters = attrs.get("lastChapter")
            try:
                total = int(chapters) if chapters else None
            except (ValueError, TypeError):
                total = None
            orig_lang = attrs.get("originalLanguage", "")
            origin = _country_to_origin(
                {"ja": "JP", "ko": "KR", "zh": "CN", "zh-hk": "HK"}.get(orig_lang, "")
            )
            # Map publicationDemographic / format to our medium
            mdx_type = attrs.get("publicationDemographic") or ""
            fmt = attrs.get("tags", [])  # unused for now
            # Use original language to refine medium for manhwa/manhua
            if orig_lang in ("ko",):
                med_resolved = "Comics"  # manhwa
            elif orig_lang in ("zh", "zh-hk"):
                med_resolved = "Comics"  # manhua
            else:
                novel_flag = any(
                    (t.get("attributes", {}).get("name", {}).get("en", "")).lower() == "novel"
                    for t in item.get("relationships", [])
                )
                if attrs.get("format") == "novel" or novel_flag:
                    med_resolved = "Light Novel"
                else:
                    med_resolved = "Manga"
            if medium:
                med_resolved = medium
            mdx_id = item.get("id", "")
            results.append(
                SearchResult(
                    title=display_title,
                    medium=med_resolved,
                    origin=origin,
                    year=pub_year,
                    cover_url=cover_url,
                    total=total,
                    external_id=mdx_id,
                    source="mangadex",
                    description=(attrs.get("description", {}).get("en") or "")[:200] or None,
                    external_url=f"https://mangadex.org/title/{mdx_id}",
                )
            )
        return results
    except Exception as exc:
        logger.warning("MangaDex search error: %s", exc)
        return []


# ── IGDB (Games) ──────────────────────────────────────────────────────────────

async def _get_igdb_token(client: httpx.AsyncClient) -> Optional[str]:
    client_id     = settings.IGDB_CLIENT_ID
    client_secret = settings.IGDB_CLIENT_SECRET
    if not client_id or not client_secret:
        return None
    try:
        r = await client.post(
            "https://id.twitch.tv/oauth2/token",
            params={
                "client_id":     client_id,
                "client_secret": client_secret,
                "grant_type":    "client_credentials",
            },
        )
        r.raise_for_status()
        return r.json().get("access_token")
    except Exception as exc:
        logger.warning("IGDB token error: %s", exc)
        return None


async def _search_igdb(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    if medium and medium not in _GAME_MEDIUMS:
        return []

    client_id = settings.IGDB_CLIENT_ID
    if not client_id:
        return []

    token = await _get_igdb_token(client)
    if not token:
        return []

    try:
        # Request cover at size t_cover_big (264×374) or t_1080p for best quality
        r = await client.post(
            "https://api.igdb.com/v4/games",
            headers={
                "Client-ID":     client_id,
                "Authorization": f"Bearer {token}",
            },
            content=(
                f'search "{title}"; '
                f'fields name,first_release_date,cover.url,cover.image_id,'
                f'summary,involved_companies.company.name,url; '
                f'limit 5;'
            ),
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json():
            cover = item.get("cover", {})
            image_id = cover.get("image_id") if cover else None
            if image_id:
                # t_cover_big_2x is the highest quality thumbnail IGDB exposes
                cover_url: Optional[str] = (
                    f"https://images.igdb.com/igdb/image/upload/t_cover_big_2x/{image_id}.jpg"
                )
            else:
                raw_url = (cover.get("url") or "") if cover else ""
                cover_url = (
                    raw_url.replace("t_thumb", "t_cover_big_2x")
                    if raw_url else None
                )
            if cover_url and cover_url.startswith("//"):
                cover_url = "https:" + cover_url
            ts = item.get("first_release_date")
            year = datetime.fromtimestamp(ts).year if ts else None
            results.append(
                SearchResult(
                    title=item.get("name", ""),
                    medium="Game",
                    origin=None,
                    year=year,
                    cover_url=cover_url,
                    external_id=str(item.get("id", "")),
                    source="igdb",
                    description=(item.get("summary") or "")[:200] or None,
                    external_url=item.get("url"),
                )
            )
        return results
    except Exception as exc:
        logger.warning("IGDB search error: %s", exc)
        return []


# ── RAWG (Games) ──────────────────────────────────────────────────────────────

async def _search_rawg(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    """
    RAWG Video Games Database — free API key required.
    Register at: https://rawg.io/apidocs
    Add RAWG_API_KEY to backend/.env
    """
    if medium and medium not in _GAME_MEDIUMS:
        return []

    api_key = settings.RAWG_API_KEY
    if not api_key:
        return []

    try:
        r = await client.get(
            "https://api.rawg.io/api/games",
            params={"key": api_key, "search": title, "page_size": 5},
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("results", []):
            # background_image is typically 600px wide — good quality
            cover = item.get("background_image")
            released = item.get("released") or ""
            year = _safe_year(released[:4]) if released else None
            rawg_id = str(item.get("id", ""))
            slug = item.get("slug", rawg_id)
            results.append(
                SearchResult(
                    title=item.get("name", ""),
                    medium="Game",
                    origin=None,
                    year=year,
                    cover_url=cover,
                    external_id=rawg_id,
                    source="rawg",
                    external_url=f"https://rawg.io/games/{slug}",
                )
            )
        return results
    except Exception as exc:
        logger.warning("RAWG search error: %s", exc)
        return []


# ── Google Books (Books, Light Novels, Web Novels) ────────────────────────────

async def _search_google_books(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    if medium and medium not in _BOOK_MEDIUMS:
        return []

    params: dict = {"q": title, "maxResults": 5, "printType": "books"}
    api_key = settings.GOOGLE_BOOKS_API_KEY
    if api_key:
        params["key"] = api_key

    try:
        r = await client.get(
            "https://www.googleapis.com/books/v1/volumes", params=params
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("items", []):
            info = item.get("volumeInfo", {})
            images = info.get("imageLinks", {})
            # Request the largest available thumbnail and upgrade to zoom=1 for higher res
            raw_cover = (
                images.get("extraLarge")
                or images.get("large")
                or images.get("medium")
                or images.get("thumbnail")
                or images.get("smallThumbnail")
            )
            # Google Books thumbnails can be upgraded by replacing zoom param
            cover = raw_cover.replace("zoom=1", "zoom=3").replace("&edge=curl", "") if raw_cover else None
            pub_date = info.get("publishedDate", "")
            year = _safe_year(pub_date)
            pages = info.get("pageCount")
            book_id = item.get("id")
            results.append(
                SearchResult(
                    title=info.get("title", ""),
                    medium=medium if medium in _BOOK_MEDIUMS else "Book",
                    origin=None,
                    year=year,
                    cover_url=cover,
                    total=pages,
                    external_id=book_id,
                    source="google_books",
                    description=(info.get("description") or "")[:200] or None,
                    external_url=f"https://books.google.com/books?id={book_id}" if book_id else None,
                )
            )
        return results
    except Exception as exc:
        logger.warning("Google Books search error: %s", exc)
        return []


# ── Open Library (Books, no key) ──────────────────────────────────────────────

async def _search_open_library(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    """
    Open Library (Internet Archive) — no API key required.
    https://openlibrary.org/developers/api
    """
    if medium and medium not in _BOOK_MEDIUMS:
        return []

    try:
        r = await client.get(
            "https://openlibrary.org/search.json",
            params={"title": title, "limit": 5, "fields": "key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn"},
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("docs", []):
            cover_i = item.get("cover_i")
            # Open Library cover sizes: S/M/L — use L for highest quality
            cover = (
                f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg"
                if cover_i else None
            )
            ol_key = item.get("key", "")  # e.g. /works/OL123W
            ol_id = ol_key.split("/")[-1] if ol_key else ""
            results.append(
                SearchResult(
                    title=item.get("title", ""),
                    medium=medium if medium in _BOOK_MEDIUMS else "Book",
                    origin=None,
                    year=item.get("first_publish_year"),
                    cover_url=cover,
                    total=item.get("number_of_pages_median"),
                    external_id=ol_id,
                    source="open_library",
                    external_url=f"https://openlibrary.org{ol_key}" if ol_key else None,
                )
            )
        return results
    except Exception as exc:
        logger.warning("Open Library search error: %s", exc)
        return []


# ── ComicVine (Comics) ────────────────────────────────────────────────────────

async def _search_comicvine(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    """
    ComicVine — free API key required.
    Register at: https://comicvine.gamespot.com/api/
    Add COMICVINE_API_KEY to backend/.env
    """
    if medium and medium not in _COMIC_MEDIUMS:
        return []

    api_key = settings.COMICVINE_API_KEY
    if not api_key:
        return []

    try:
        r = await client.get(
            "https://comicvine.gamespot.com/api/search/",
            params={
                "api_key": api_key,
                "format": "json",
                "query": title,
                "resources": "volume",
                "limit": 5,
                "field_list": "id,name,start_year,image,description,site_detail_url,count_of_issues",
            },
            headers={"User-Agent": "LOG-MediaTracker/1.0"},
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("results", []):
            img = item.get("image", {})
            # ComicVine image sizes: icon, medium, screen, screen_large, small, super, thumb, tiny, original
            cover = (
                img.get("original_url")
                or img.get("screen_large_url")
                or img.get("medium_url")
            )
            year = None
            try:
                raw_year = item.get("start_year")
                year = int(raw_year) if raw_year else None
            except (ValueError, TypeError):
                pass
            cv_id = str(item.get("id", ""))
            results.append(
                SearchResult(
                    title=item.get("name", ""),
                    medium="Comics",
                    origin="Western",
                    year=year,
                    cover_url=cover,
                    total=item.get("count_of_issues"),
                    external_id=cv_id,
                    source="comicvine",
                    description=(item.get("description") or "")[:200] or None,
                    external_url=item.get("site_detail_url"),
                )
            )
        return results
    except Exception as exc:
        logger.warning("ComicVine search error: %s", exc)
        return []

# ── MangaUpdates (Manga, Light Novel, Web Novel, Comics) ──────────────────────

_MANGAUPDATES_TYPE_TO_MEDIUM: dict[str, str] = {
    "Manga": "Manga",
    "Manhwa": "Comics",      # Korean comics
    "Manhua": "Comics",      # Chinese comics
    "Novel": "Light Novel",
    "Light Novel": "Light Novel",
    "Doujinshi": "Manga",
    "OEL": "Comics",         # Original English Language
    "Artbook": "Manga",
}

async def _search_mangaupdates(
    client: httpx.AsyncClient, title: str, medium: str
) -> list[SearchResult]:
    """
    MangaUpdates public API — no API key required.
    https://api.mangaupdates.com/
    Credit: MangaUpdates (per their acceptable use policy).
    """
    if medium and medium not in _MANGA_MEDIUMS and medium not in _COMIC_MEDIUMS:
        return []

    try:
        r = await client.post(
            "https://api.mangaupdates.com/v1/series/search",
            json={"search": title, "perpage": 8},
        )
        r.raise_for_status()
        results: list[SearchResult] = []
        for item in r.json().get("results", []):
            record = item.get("record", {})
            mu_id = str(record.get("series_id", ""))
            display_title = record.get("title", "")
            # Image: record.image.url.original is highest quality
            img = record.get("image", {})
            img_url = img.get("url", {})
            cover = (
                img_url.get("original")
                or img_url.get("thumb")
            )
            year_str = record.get("year") or ""
            try:
                year = int(str(year_str)[:4]) if year_str else None
            except (ValueError, TypeError):
                year = None
            # Map MangaUpdates type to our medium
            mu_type = record.get("type") or ""
            med_resolved = _MANGAUPDATES_TYPE_TO_MEDIUM.get(mu_type, "Manga")
            if medium:
                med_resolved = medium
            # MangaUpdates is primarily Japanese manga, but type field tells us otherwise
            if mu_type == "Manhwa":
                origin = "Korean"
            elif mu_type == "Manhua":
                origin = "Chinese"
            elif mu_type in ("OEL",):
                origin = "Western"
            else:
                origin = "Japanese"
            desc = record.get("description") or ""
            # Strip HTML tags MangaUpdates sometimes includes in descriptions
            import re
            desc = re.sub(r"<[^>]+>", "", desc)
            results.append(
                SearchResult(
                    title=display_title,
                    medium=med_resolved,
                    origin=origin,
                    year=year,
                    cover_url=cover,
                    external_id=mu_id,
                    source="mangaupdates",
                    description=desc[:200] or None,
                    external_url=record.get("url"),
                )
            )
        return results
    except Exception as exc:
        logger.warning("MangaUpdates search error: %s", exc)
        return []
    

# ── Deduplication & ranking ───────────────────────────────────────────────────

# Provider preference order when two results look like duplicates.
# Lower index = higher trust for cover quality / metadata completeness.
_SOURCE_PRIORITY = [
    "mangaupdates", # best manga metadata, highly curated
    "tmdb",         # best film/TV metadata
    "igdb",         # best game metadata
    "jikan",        # MAL data — preferred over AniList for anime & manga
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
    from collections import defaultdict

    groups: dict[tuple[str, str], list[SearchResult]] = defaultdict(list)
    for r in combined:
        key = (r.title.lower().strip(), r.medium)
        groups[key].append(r)

    deduped: list[SearchResult] = []
    for items in groups.values():
        items.sort(key=lambda x: _source_rank(x.source))
        best = items[0]
        # If best has no cover, try to borrow one
        if not best.cover_url:
            for fallback in items[1:]:
                if fallback.cover_url:
                    best = SearchResult(
                        **{**best.model_dump(), "cover_url": fallback.cover_url}
                    )
                    break
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

async def search_media(title: str, medium: str = "") -> list[SearchResult]:
    """
    Fan-out search across all relevant providers in parallel.
    Results are de-duplicated, ranked, and capped at 10.
    """
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        tasks = [
            _search_tmdb(client, title, medium),
            _search_anilist(client, title, medium),
            _search_jikan(client, title, medium),
            _search_kitsu(client, title, medium),
            # _search_mangaupdates(client, title, medium),
            _search_mangadex(client, title, medium),
            _search_igdb(client, title, medium),
            _search_rawg(client, title, medium),
            _search_google_books(client, title, medium),
            _search_open_library(client, title, medium),
            _search_comicvine(client, title, medium),
        ]
        groups = await asyncio.gather(*tasks, return_exceptions=True)

    combined: list[SearchResult] = []
    for group in groups:
        if isinstance(group, Exception):
            logger.warning("Search provider exception: %s", group)
            continue
        combined.extend(group)

    return _deduplicate_and_rank(combined, title)[:10]