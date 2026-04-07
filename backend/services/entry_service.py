from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select, asc, desc, and_
from sqlalchemy.orm import Session

from models import Entry
from schemas import EntryCreate, EntryUpdate, EntryListResponse, EntryRead, DuplicateCheckItem

# Columns that the frontend is allowed to sort by
SORTABLE_COLUMNS: dict[str, object] = {
    "title":        Entry.title,
    "medium":       Entry.medium,
    "origin":       Entry.origin,
    "year":         Entry.year,
    "status":       Entry.status,
    "rating":       Entry.rating,
    "created_at":   Entry.created_at,
    "updated_at":   Entry.updated_at,
    "completed_at": Entry.completed_at,
}


def _apply_filters(q, *, status, medium, origin, title):
    """Apply optional WHERE clauses to a query."""
    if status:
        q = q.where(Entry.status == status)
    if medium:
        q = q.where(Entry.medium == medium)
    if origin:
        q = q.where(Entry.origin == origin)
    if title:
        q = q.where(Entry.title.ilike(f"%{title}%"))
    return q


# ── Read ──────────────────────────────────────────────────────────────────────

def get_entries(
    db: Session,
    *,
    username: str,
    status: Optional[str] = None,
    medium: Optional[str] = None,
    origin: Optional[str] = None,
    title:  Optional[str] = None,
    sort:   str = "updated_at",
    order:  str = "desc",
    limit:  int = 40,
    offset: int = 0,
) -> EntryListResponse:
    sort_col = SORTABLE_COLUMNS.get(sort, Entry.updated_at)
    direction = asc if order == "asc" else desc

    base_q = select(Entry).where(Entry.username == username)
    base_q = _apply_filters(base_q, status=status, medium=medium, origin=origin, title=title)

    # Total count (before pagination)
    count_q = select(func.count()).select_from(base_q.subquery())
    total = db.execute(count_q).scalar_one()

    # Paginated results
    rows = db.execute(
        base_q.order_by(direction(sort_col)).limit(limit).offset(offset)
    ).scalars().all()

    return EntryListResponse(
        items=[EntryRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_entry_by_id(db: Session, entry_id: int) -> Optional[Entry]:
    return db.get(Entry, entry_id)


# ── Create ────────────────────────────────────────────────────────────────────

def create_entry(db: Session, payload: EntryCreate, username: str) -> Entry:
    data = payload.model_dump(exclude_none=False)
    entry = Entry(**data, username=username)

    # If created as completed, use provided completed_at or auto-stamp
    if entry.status == "completed":
        if entry.completed_at is None:
            entry.completed_at = datetime.now(timezone.utc)
        # Auto-set progress to total to indicate full completion
        if entry.total is not None:
            entry.progress = entry.total

    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ── Update ────────────────────────────────────────────────────────────────────

def update_entry(db: Session, entry: Entry, payload: EntryUpdate) -> Entry:
    data = payload.model_dump(exclude_unset=True)

    for field, value in data.items():
        setattr(entry, field, value)

    # Handle completed_at when status changes to completed
    if data.get("status") == "completed":
        # Auto-stamp only if completed_at was not explicitly provided in this update
        if entry.completed_at is None:
            entry.completed_at = datetime.now(timezone.utc)
        # Auto-set progress to total
        if entry.total is not None:
            entry.progress = entry.total

    # Clear completed_at if status moves away from completed
    if data.get("status") and data["status"] != "completed":
        entry.completed_at = None

    entry.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(entry)
    return entry


# ── Delete ────────────────────────────────────────────────────────────────────

def delete_entry(db: Session, entry: Entry) -> None:
    db.delete(entry)
    db.commit()


def check_duplicates(db: Session, username: str, items: list[DuplicateCheckItem]) -> list[bool]:
    results = []
    for item in items:
        conditions = [
            Entry.username == username,
            func.lower(Entry.title) == item.title.lower(),
        ]
        if item.medium:
            conditions.append(Entry.medium == item.medium)
        if item.year is not None:
            conditions.append(Entry.year == item.year)
        exists = db.execute(
            select(Entry.id).where(and_(*conditions)).limit(1)
        ).scalar() is not None
        results.append(exists)
    return results


def delete_all_entries(db: Session, username: str) -> None:
    db.query(Entry).filter(Entry.username == username).delete()
    db.commit()
