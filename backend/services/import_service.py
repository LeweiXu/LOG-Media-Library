#!/usr/bin/env python3
"""
Import a CSV of personal media entries into the MediaTrack database.

Usage (run from the backend/ directory):
    python services/import_service.py [path/to/file.csv]

Defaults to ../../personal.csv relative to this script if no path is given.

CSV columns expected:
    Title, Type, Enjoyment, Objective, Date, Chapter/Episode, Notes

Column mapping:
    Title           → title
    Type            → medium  (normalised to app mediums)
    Objective       → rating
    Date            → completed_at  (DD/MM/YY)
    Chapter/Episode → progress / status
    Notes           → notes

For each row the script searches for the first result via search_media() to
auto-fill cover_url, year, origin, external_id, source, and total.
If search returns nothing, only CSV data is used.
"""
from __future__ import annotations

import asyncio
import csv
import io
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

# ── Path fix so imports work when called from backend/ ────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_DIR))

from db import SessionLocal
from models import Entry
from services.search_service import search_media

# ── Medium normalisation ──────────────────────────────────────────────────────

_MEDIUM_MAP: dict[str, str] = {
    "web novel":    "Web Novel",
    "webnovel":     "Web Novel",
    "light novel":  "Light Novel",
    "anime":        "Anime",
    "donghua":      "Anime",   # Chinese animation → Anime
    "manga":        "Manga",
    "manhwa":       "Manga",   # Korean manga → Manga
    "manhua":       "Manga",   # Chinese manga → Manga
    "film":         "Film",
    "movie":        "Film",
    "tv show":      "TV Show",
    "tv":           "TV Show",
    "book":         "Book",
    "comics":       "Comics",
    "comic":        "Comics",
    "game":         "Game",
}

def _normalise_medium(raw: str) -> str:
    return _MEDIUM_MAP.get(raw.strip().lower(), raw.strip())


# ── Progress / status parsing ─────────────────────────────────────────────────

def _parse_progress(chap_ep: str) -> tuple[Optional[int], str]:
    """
    Returns (progress_or_None, status).

    "Completed"   → (None, "completed")
    "C325"        → (325, "current")
    "V2C29"       → (29, "current")   # chapter takes precedence
    "V12"         → (None, "current") # volume only, can't map to int progress
    "C45?"        → (45, "current")   # trailing ? stripped
    anything else → (None, "current")
    """
    val = chap_ep.strip()
    if val.lower() == "completed":
        return None, "completed"

    # Extract chapter number (C123 pattern)
    m = re.search(r'[Cc](\d+)', val)
    if m:
        return int(m.group(1)), "current"

    # Volume-only (V12) or unknown
    return None, "current"


# ── Date parsing ──────────────────────────────────────────────────────────────

def _parse_date(date_str: str) -> Optional[datetime]:
    for fmt in ("%d/%m/%y", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


# ── Main import logic ─────────────────────────────────────────────────────────

USERNAME = "lingwei"
SEARCH_DELAY = 0.4  # seconds between API calls to avoid rate limits


async def _import_rows(rows: list[dict]) -> None:
    db = SessionLocal()
    created = 0
    skipped = 0

    try:
        for i, row in enumerate(rows, start=1):
            title      = row.get("Title", "").strip()
            raw_medium = row.get("Type", "").strip()
            objective  = row.get("Objective", "").strip()
            date_str   = row.get("Date", "").strip()
            chap_ep    = row.get("Chapter/Episode", "").strip()
            notes      = row.get("Notes", "").strip() or None

            if not title:
                print(f"  [{i}] SKIP — empty title")
                skipped += 1
                continue

            medium   = _normalise_medium(raw_medium)
            progress, status = _parse_progress(chap_ep)
            completed_at     = _parse_date(date_str) if status == "completed" else None

            rating: Optional[float] = None
            try:
                rating = float(objective)
            except (ValueError, TypeError):
                pass

            # ── Search for metadata ───────────────────────────────────────────
            cover_url   = None
            year        = None
            origin      = None
            external_id = None
            source      = None
            total       = None

            try:
                results = await search_media(title, medium)
                if results:
                    r = results[0]
                    cover_url   = r.cover_url
                    year        = r.year
                    origin      = r.origin
                    external_id = r.external_id
                    source      = r.source
                    total       = r.total
                    print(f"  [{i}/{len(rows)}] FOUND  '{title}' → '{r.title}' ({r.source})")
                else:
                    print(f"  [{i}/{len(rows)}] NO HIT '{title}' (medium={medium})")
            except Exception as exc:
                print(f"  [{i}/{len(rows)}] SEARCH ERROR '{title}': {exc}")

            entry = Entry(
                title=title,
                medium=medium,
                origin=origin,
                year=year,
                cover_url=cover_url,
                notes=notes,
                status=status,
                rating=rating,
                progress=progress,
                total=total,
                external_id=external_id,
                source=source,
                completed_at=completed_at,
                username=USERNAME,
            )
            db.add(entry)
            db.commit()
            created += 1

            if i < len(rows):
                await asyncio.sleep(SEARCH_DELAY)

    finally:
        db.close()

    print(f"\nDone. Created {created} entries, skipped {skipped}.")


_VALID_STATUSES = {"current", "planned", "completed", "on_hold", "dropped"}

# ── Export-format helpers (used by preview/confirm) ───────────────────────────

EXPORT_HEADERS = [
    "title", "medium", "origin", "year", "cover_url", "notes",
    "external_id", "source", "status", "rating", "progress", "total",
    "created_at", "updated_at", "completed_at",
]

_COMPARE_FIELDS = [
    "title", "medium", "origin", "year", "cover_url", "notes",
    "external_id", "source", "status", "rating", "progress", "total", "completed_at",
]


def _csv_to_typed(row: dict) -> dict:
    """Convert a raw CSV row (all string values) to typed Python values."""
    def _int(v):
        try:
            s = (v or "").strip()
            return int(s) if s else None
        except (ValueError, TypeError):
            return None

    def _float(v):
        try:
            s = (v or "").strip()
            return float(s) if s else None
        except (ValueError, TypeError):
            return None

    def _str(v):
        s = (v or "").strip()
        return s or None

    def _dt(v):
        s = (v or "").strip()
        if not s:
            return None
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return _parse_date(s)

    raw_status = _str(row.get("status")) or "planned"
    return {
        "title":       _str(row.get("title")),
        "medium":      _str(row.get("medium")),
        "origin":      _str(row.get("origin")),
        "year":        _int(row.get("year")),
        "cover_url":   _str(row.get("cover_url")),
        "notes":       _str(row.get("notes")),
        "external_id": _str(row.get("external_id")),
        "source":      _str(row.get("source")),
        "status":      raw_status if raw_status in _VALID_STATUSES else "planned",
        "rating":      _float(row.get("rating")),
        "progress":    _int(row.get("progress")),
        "total":       _int(row.get("total")),
        "completed_at": _dt(row.get("completed_at")),
    }


def _dt_equal(a: Optional[datetime], b: Optional[datetime]) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    a_u = a.astimezone(timezone.utc) if a.tzinfo else a.replace(tzinfo=timezone.utc)
    b_u = b.astimezone(timezone.utc) if b.tzinfo else b.replace(tzinfo=timezone.utc)
    return a_u.replace(microsecond=0) == b_u.replace(microsecond=0)


def _fields_equal(field: str, csv_val, db_val) -> bool:
    if field == "completed_at":
        return _dt_equal(csv_val, db_val)
    return csv_val == db_val


def _entry_to_dict(entry: "Entry") -> dict:
    result = {"id": entry.id}
    for col in EXPORT_HEADERS:
        val = getattr(entry, col)
        if isinstance(val, datetime):
            val = val.isoformat()
        result[col] = val
    return result


def preview_import(db: Session, csv_content: str, username: str) -> dict:
    """
    Validate CSV headers and categorise each row as:
      - to_import:        no DB entry with same title+medium+year
      - exact_duplicates: identical to an existing entry in all compared fields
      - conflicts:        same title+medium+year but at least one differing field
    Returns a dict safe for JSON serialisation.
    """
    reader = csv.DictReader(io.StringIO(csv_content))
    if list(reader.fieldnames or []) != EXPORT_HEADERS:
        return {
            "error": "Invalid CSV headers. This file must be exported from this app.",
            "to_import": [],
            "exact_duplicates": [],
            "conflicts": [],
        }

    rows = list(reader)
    db_entries = db.query(Entry).filter(Entry.username == username).all()

    to_import: list[dict] = []
    exact_duplicates: list[dict] = []
    conflicts: list[dict] = []

    for row in rows:
        typed = _csv_to_typed(row)
        title = typed.get("title")
        if not title:
            continue

        medium = typed.get("medium")
        year = typed.get("year")

        identity_matches = [
            e for e in db_entries
            if e.title == title and e.medium == medium and e.year == year
        ]

        if not identity_matches:
            to_import.append(row)
            continue

        # Check each match for exact equality
        exact_found = any(
            all(_fields_equal(f, typed.get(f), getattr(e, f)) for f in _COMPARE_FIELDS)
            for e in identity_matches
        )

        if exact_found:
            exact_duplicates.append(row)
        else:
            for db_entry in identity_matches:
                conflicts.append({
                    "csv_row": row,
                    "db_entry": _entry_to_dict(db_entry),
                })

    return {
        "error": None,
        "to_import": to_import,
        "exact_duplicates": exact_duplicates,
        "conflicts": conflicts,
    }


def confirm_import(
    db: Session,
    to_create: list[dict],
    to_update: list[dict],
    username: str,
) -> dict:
    """
    Execute the import after the user has resolved conflicts.
    to_create: raw CSV row dicts to insert as new entries.
    to_update: list of {"db_id": int, "csv_row": {raw CSV row}} for updates.
    Returns {"created": N, "updated": N, "skipped": N}.
    """
    created = updated = skipped = 0

    for row in to_create:
        typed = _csv_to_typed(row)
        if not typed.get("title"):
            skipped += 1
            continue
        db.add(Entry(
            title=typed["title"],
            medium=typed.get("medium"),
            origin=typed.get("origin"),
            year=typed.get("year"),
            cover_url=typed.get("cover_url"),
            notes=typed.get("notes"),
            external_id=typed.get("external_id"),
            source=typed.get("source"),
            status=typed["status"],
            rating=typed.get("rating"),
            progress=typed.get("progress"),
            total=typed.get("total"),
            completed_at=typed.get("completed_at"),
            username=username,
        ))
        created += 1

    for item in to_update:
        entry = db.query(Entry).filter(
            Entry.id == item.get("db_id"),
            Entry.username == username,
        ).first()
        if not entry:
            skipped += 1
            continue
        typed = _csv_to_typed(item.get("csv_row", {}))
        if not typed.get("title"):
            skipped += 1
            continue
        entry.title      = typed["title"]
        entry.medium     = typed.get("medium")
        entry.origin     = typed.get("origin")
        entry.year       = typed.get("year")
        entry.cover_url  = typed.get("cover_url")
        entry.notes      = typed.get("notes")
        entry.external_id = typed.get("external_id")
        entry.source     = typed.get("source")
        entry.status     = typed["status"]
        entry.rating     = typed.get("rating")
        entry.progress   = typed.get("progress")
        entry.total      = typed.get("total")
        entry.completed_at = typed.get("completed_at")
        updated += 1

    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped}


def import_csv_for_user(db: Session, csv_content: str, username: str) -> dict:
    """
    Import entries from a CSV exported by this app (all DB columns).
    The `id`, `created_at`, and `updated_at` columns are ignored — new values
    are assigned by the database.
    Returns {"created": N, "skipped": N}.
    """
    def _int(val: str | None) -> Optional[int]:
        try:
            v = (val or "").strip()
            return int(v) if v else None
        except (ValueError, TypeError):
            return None

    def _float(val: str | None) -> Optional[float]:
        try:
            v = (val or "").strip()
            return float(v) if v else None
        except (ValueError, TypeError):
            return None

    def _str(val: str | None) -> Optional[str]:
        v = (val or "").strip()
        return v or None

    def _dt(val: str | None) -> Optional[datetime]:
        v = (val or "").strip()
        if not v:
            return None
        # Try DD/MM/YY and DD/MM/YYYY first (legacy format)
        parsed = _parse_date(v)
        if parsed:
            return parsed
        # Try ISO 8601
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None

    reader = csv.DictReader(io.StringIO(csv_content))
    created = 0
    skipped = 0

    for row in reader:
        title = _str(row.get("title"))
        if not title:
            skipped += 1
            continue

        raw_status = _str(row.get("status")) or "planned"
        status = raw_status if raw_status in _VALID_STATUSES else "planned"

        entry = Entry(
            title=title,
            medium=_str(row.get("medium")),
            origin=_str(row.get("origin")),
            year=_int(row.get("year")),
            cover_url=_str(row.get("cover_url")),
            notes=_str(row.get("notes")),
            external_id=_str(row.get("external_id")),
            source=_str(row.get("source")),
            status=status,
            rating=_float(row.get("rating")),
            progress=_int(row.get("progress")),
            total=_int(row.get("total")),
            completed_at=_dt(row.get("completed_at")),
            username=username,
        )
        db.add(entry)
        created += 1

    db.commit()
    return {"created": created, "skipped": skipped}


def main() -> None:
    csv_path = Path(sys.argv[1]) if len(sys.argv) > 1 else _BACKEND_DIR.parent / "personal.csv"

    if not csv_path.exists():
        print(f"ERROR: CSV file not found: {csv_path}")
        sys.exit(1)

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"Importing {len(rows)} rows from {csv_path} for user '{USERNAME}' …\n")
    asyncio.run(_import_rows(rows))


if __name__ == "__main__":
    main()
