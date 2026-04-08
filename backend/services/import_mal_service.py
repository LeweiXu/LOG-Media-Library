"""
Import entries from a MyAnimeList XML export file.

Flow:
  1. Parse the XML (anime and/or manga elements).
  2. For each entry, look up metadata from Jikan using the MAL ID directly.
  3. Soft-match (>=0.99 title similarity) against the user's existing DB entries.
     - No match  → create entry immediately, yield log event.
     - Match      → collect as a conflict, yield log event.
  4. Yield a final "done" event containing counts and the conflicts list.

A separate confirm_mal_import() function handles inserting the user-approved
conflict entries after the frontend presents them for review.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Optional
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy.orm import Session

from models import Entry

# ── Constants ─────────────────────────────────────────────────────────────────

JIKAN_DELAY = 0.4  # seconds between Jikan API requests

# MAL status → canonical app status
MAL_STATUS_MAP: dict[str, str] = {
    "watching":      "current",
    "reading":       "current",
    "completed":     "completed",
    "on-hold":       "on_hold",
    "on hold":       "on_hold",
    "dropped":       "dropped",
    "plan to watch": "planned",
    "plan to read":  "planned",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _map_status(mal_status: str) -> str:
    return MAL_STATUS_MAP.get(mal_status.strip().lower(), "planned")


def _parse_date(date_str: str) -> Optional[datetime]:
    """Parse MAL date format YYYY-MM-DD; returns None for '0000-00-00' or empty."""
    s = (date_str or "").strip()
    if not s or s.startswith("0000"):
        return None
    try:
        dt = datetime.strptime(s, "%Y-%m-%d")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _to_int(v: str) -> Optional[int]:
    try:
        s = (v or "").strip()
        val = int(s) if s else None
        return None if val == 0 else val
    except (ValueError, TypeError):
        return None


def _to_float_score(v: str) -> Optional[float]:
    """Convert MAL score string to float; returns None when score is 0 (unrated)."""
    try:
        s = (v or "").strip()
        val = float(s) if s else 0.0
        return None if val == 0.0 else val
    except (ValueError, TypeError):
        return None


def _title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _find_soft_match(
    title: str, db_entries: list[Entry], threshold: float = 0.99
) -> Optional[Entry]:
    """Return the best-matching DB entry if similarity >= threshold, else None."""
    best: Optional[Entry] = None
    best_score = 0.0
    for e in db_entries:
        score = _title_similarity(title, e.title)
        if score >= threshold and score > best_score:
            best_score = score
            best = e
    return best


def _entry_to_dict(entry: Entry) -> dict:
    """Serialize an Entry ORM object to a JSON-safe dict."""
    return {
        "id": entry.id,
        "title": entry.title,
        "medium": entry.medium,
        "origin": entry.origin,
        "year": entry.year,
        "cover_url": entry.cover_url,
        "status": entry.status,
        "rating": entry.rating,
        "progress": entry.progress,
        "total": entry.total,
        "notes": entry.notes,
        "external_id": entry.external_id,
        "source": entry.source,
        "external_url": entry.external_url,
        "genres": entry.genres,
        "external_rating": entry.external_rating,
        "completed_at": entry.completed_at.isoformat() if entry.completed_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


# ── XML parsing ───────────────────────────────────────────────────────────────

def _parse_mal_xml(xml_content: str) -> list[dict]:
    """
    Parse MAL XML export.
    Returns a flat list of raw entry dicts with keys:
        mal_id, title, total, progress, score, status, notes, finish_date, type
    """
    root = ET.fromstring(xml_content)
    entries: list[dict] = []

    for anime in root.findall("anime"):
        title = (anime.findtext("series_title") or "").strip()
        if not title:
            continue
        entries.append({
            "mal_id":      (anime.findtext("series_animedb_id") or "").strip(),
            "title":       title,
            "total":       (anime.findtext("series_episodes") or "").strip(),
            "progress":    (anime.findtext("my_watched_episodes") or "").strip(),
            "score":       (anime.findtext("my_score") or "0").strip(),
            "status":      (anime.findtext("my_status") or "").strip(),
            "notes":       (anime.findtext("my_comments") or "").strip(),
            "finish_date": (anime.findtext("my_finish_date") or "").strip(),
            "type":        "anime",
        })

    for manga in root.findall("manga"):
        title = (manga.findtext("manga_title") or "").strip()
        if not title:
            continue
        entries.append({
            "mal_id":      (manga.findtext("manga_mangadb_id") or "").strip(),
            "title":       title,
            "total":       (manga.findtext("manga_chapters") or "").strip(),
            "progress":    (manga.findtext("my_read_chapters") or "").strip(),
            "score":       (manga.findtext("my_score") or "0").strip(),
            "status":      (manga.findtext("my_status") or "").strip(),
            "notes":       (manga.findtext("my_comments") or "").strip(),
            "finish_date": (manga.findtext("my_finish_date") or "").strip(),
            "type":        "manga",
        })

    return entries


# ── Jikan metadata fetch ──────────────────────────────────────────────────────

async def _fetch_jikan_metadata(
    client: httpx.AsyncClient, mal_id: str, entry_type: str
) -> Optional[dict]:
    """
    Fetch metadata from Jikan v4 using the MAL ID directly.
    entry_type: 'anime' or 'manga'
    Returns a metadata dict or None on failure.
    """
    if not mal_id:
        return None

    url = f"https://api.jikan.moe/v4/{entry_type}/{mal_id}"
    try:
        r = await client.get(url, timeout=10.0)
        r.raise_for_status()
        data = r.json().get("data") or {}
        if not data:
            return None

        # Prefer English title
        titles = data.get("titles") or []
        display_title = next(
            (t["title"] for t in titles if t.get("type") == "English"), None
        ) or data.get("title") or ""

        images = data.get("images") or {}
        jpg  = images.get("jpg")  or {}
        webp = images.get("webp") or {}
        cover = (
            webp.get("large_image_url")
            or jpg.get("large_image_url")
            or webp.get("image_url")
            or jpg.get("image_url")
        )

        episodes = data.get("episodes") or data.get("chapters")
        aired = data.get("aired") or data.get("published") or {}
        prop = aired.get("prop", {}).get("from", {})
        year = prop.get("year")
        if not year:
            aired_from = (aired.get("from") or "")[:4]
            try:
                year = int(aired_from) if aired_from else None
            except (ValueError, TypeError):
                year = None

        genres_str = ", ".join(
            g["name"] for g in (data.get("genres") or [])[:5] if g.get("name")
        ) or None

        score = data.get("score")
        ext_rating = round(float(score), 1) if score else None

        # Determine medium from MAL type sub-field
        mal_type_field = (data.get("type") or "").lower()
        if entry_type == "anime":
            medium = "Anime"
        else:
            if "light novel" in mal_type_field or "novel" in mal_type_field:
                medium = "Light Novel"
            else:
                medium = "Manga"

        return {
            "title":           display_title or None,
            "medium":          medium,
            "origin":          "Japanese",
            "year":            year,
            "cover_url":       cover,
            "total":           episodes,
            "external_id":     str(mal_id),
            "source":          "jikan",
            "external_url":    f"https://myanimelist.net/{entry_type}/{mal_id}",
            "genres":          genres_str,
            "external_rating": ext_rating,
        }
    except Exception:
        return None


# ── Main import generator ─────────────────────────────────────────────────────

async def import_mal_rows(xml_content: str, db: Session, username: str):
    """
    Async generator that yields SSE event dicts.

    Events:
      {"type": "log",   "message": "..."}
      {"type": "done",  "created": N, "skipped": N, "conflicts": [...]}

    Each conflict entry:
      {"imported": {entry fields...}, "existing": {entry fields with id...}}
    """
    try:
        all_entries = _parse_mal_xml(xml_content)
    except ET.ParseError as exc:
        yield {"type": "error", "message": f"Invalid XML: {exc}"}
        return

    total = len(all_entries)
    if total == 0:
        yield {"type": "done", "created": 0, "skipped": 0, "conflicts": []}
        return

    # Load all user DB entries once for soft matching
    db_entries: list[Entry] = db.query(Entry).filter(Entry.username == username).all()

    created  = 0
    skipped  = 0
    conflicts: list[dict] = []

    async with httpx.AsyncClient() as client:
        for i, raw in enumerate(all_entries, start=1):
            title = raw["title"]
            if not title:
                skipped += 1
                yield {"type": "log", "message": f"[{i}/{total}] SKIP — empty title"}
                continue

            entry_type   = raw["type"]
            mal_id       = raw["mal_id"]
            status       = _map_status(raw["status"])
            score        = _to_float_score(raw["score"])
            progress     = _to_int(raw["progress"])
            total_val    = _to_int(raw["total"])
            notes        = raw["notes"] or None
            completed_at = _parse_date(raw["finish_date"])

            # ── Jikan lookup ──────────────────────────────────────────────────
            meta = await _fetch_jikan_metadata(client, mal_id, entry_type)

            if meta:
                jikan_title = meta.get("title") or title
                display = (
                    f"'{title}' → '{jikan_title}'"
                    if jikan_title != title
                    else f"'{title}'"
                )
                yield {"type": "log", "message": f"[{i}/{total}] FOUND  {display} (jikan)"}
                canonical_title  = jikan_title
                medium           = meta["medium"]
                origin           = meta["origin"]
                year             = meta["year"]
                cover_url        = meta["cover_url"]
                external_id      = meta["external_id"] or mal_id
                source           = meta["source"]
                external_url     = meta["external_url"]
                genres           = meta["genres"]
                external_rating  = meta["external_rating"]
                total_val        = total_val or meta["total"]
            else:
                yield {"type": "log", "message": f"[{i}/{total}] NO HIT '{title}' (jikan id={mal_id})"}
                canonical_title  = title
                medium           = "Anime" if entry_type == "anime" else "Manga"
                origin           = "Japanese"
                year             = None
                cover_url        = None
                external_id      = mal_id
                source           = "jikan"
                external_url     = (
                    f"https://myanimelist.net/{entry_type}/{mal_id}" if mal_id else None
                )
                genres           = None
                external_rating  = None

            # ── Soft match check ──────────────────────────────────────────────
            match = _find_soft_match(canonical_title, db_entries, threshold=0.99)

            imported_data = {
                "title":           canonical_title,
                "medium":          medium,
                "origin":          origin,
                "year":            year,
                "cover_url":       cover_url,
                "status":          status,
                "rating":          score,
                "progress":        progress,
                "total":           total_val,
                "notes":           notes,
                "external_id":     external_id,
                "source":          source,
                "external_url":    external_url,
                "genres":          genres,
                "external_rating": external_rating,
                "completed_at":    completed_at.isoformat() if completed_at else None,
            }

            if match:
                yield {
                    "type": "log",
                    "message": (
                        f"[{i}/{total}] MATCH  '{canonical_title}'"
                        f" ~ existing '{match.title}'"
                    ),
                }
                conflicts.append({
                    "imported": imported_data,
                    "existing": _entry_to_dict(match),
                })
            else:
                entry = Entry(
                    title=canonical_title,
                    medium=medium,
                    origin=origin,
                    year=year,
                    cover_url=cover_url,
                    notes=notes,
                    status=status,
                    rating=score,
                    progress=progress,
                    total=total_val,
                    external_id=external_id,
                    source=source,
                    external_url=external_url,
                    genres=genres,
                    external_rating=external_rating,
                    completed_at=completed_at,
                    username=username,
                )
                db.add(entry)
                db.commit()
                db_entries.append(entry)  # include in future soft-match checks
                created += 1

            if i < total:
                await asyncio.sleep(JIKAN_DELAY)

    yield {"type": "done", "created": created, "skipped": skipped, "conflicts": conflicts}


# ── Conflict confirm ──────────────────────────────────────────────────────────

def confirm_mal_import(db: Session, entries: list[dict], username: str) -> dict:
    """
    Insert user-approved conflict entries into the database.
    entries: list of imported entry data dicts the user chose to add.
    Returns {"created": N, "skipped": N}.
    """
    created = 0
    skipped = 0

    for data in entries:
        title = (data.get("title") or "").strip()
        if not title:
            skipped += 1
            continue

        completed_at = None
        raw_dt = data.get("completed_at")
        if raw_dt:
            try:
                completed_at = datetime.fromisoformat(raw_dt)
            except (ValueError, TypeError):
                pass

        db.add(Entry(
            title=title,
            medium=data.get("medium"),
            origin=data.get("origin"),
            year=data.get("year"),
            cover_url=data.get("cover_url"),
            notes=data.get("notes"),
            status=data.get("status", "planned"),
            rating=data.get("rating"),
            progress=data.get("progress"),
            total=data.get("total"),
            external_id=data.get("external_id"),
            source=data.get("source"),
            external_url=data.get("external_url"),
            genres=data.get("genres"),
            external_rating=data.get("external_rating"),
            completed_at=completed_at,
            username=username,
        ))
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped}
