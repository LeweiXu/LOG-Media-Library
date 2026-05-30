from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select, asc, desc, and_, or_, nullslast
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


def _normalise_custom_list(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _apply_filters(q, *, status, medium, origin, title, custom_list, custom_list_empty=False):
    """Apply optional WHERE clauses to a query."""
    if status:
        q = q.where(Entry.status == status)
    if medium:
        q = q.where(Entry.medium == medium)
    if origin:
        q = q.where(Entry.origin == origin)
    if title:
        q = q.where(Entry.title.ilike(f"%{title}%"))
    if custom_list_empty:
        q = q.where(or_(Entry.custom_list.is_(None), Entry.custom_list == ""))
    elif custom_list:
        normalised = _normalise_custom_list(custom_list)
        if normalised:
            q = q.where(Entry.custom_list == normalised)
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
    custom_list: Optional[str] = None,
    custom_list_empty: bool = False,
    sort:   str = "updated_at",
    order:  str = "desc",
    limit:  int = 40,
    offset: int = 0,
) -> EntryListResponse:
    sort_col = SORTABLE_COLUMNS.get(sort, Entry.updated_at)
    direction = asc if order == "asc" else desc

    base_q = select(Entry).where(Entry.username == username)
    base_q = _apply_filters(
        base_q,
        status=status,
        medium=medium,
        origin=origin,
        title=title,
        custom_list=custom_list,
        custom_list_empty=custom_list_empty,
    )

    # Total count (before pagination)
    count_q = select(func.count()).select_from(base_q.subquery())
    total = db.execute(count_q).scalar_one()

    # Paginated results — always put NULLs last so unrated/undated entries
    # don't float to the top when sorting descending.
    # Secondary sort by title ASC ensures consistent ordering within ties.
    order_clauses = [nullslast(direction(sort_col))]
    if sort != "title":
        order_clauses.append(asc(Entry.title))
    rows = db.execute(
        base_q.order_by(*order_clauses).limit(limit).offset(offset)
    ).scalars().all()

    return EntryListResponse(
        items=[EntryRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def get_entry_by_id(db: Session, entry_id: int) -> Optional[Entry]:
    return db.get(Entry, entry_id)


def get_custom_lists(db: Session, username: str) -> list[dict]:
    latest_updated = func.max(Entry.updated_at).label("updated_at")
    rows = db.execute(
        select(Entry.custom_list, func.count(Entry.id), latest_updated)
        .where(Entry.username == username, Entry.custom_list.is_not(None), Entry.custom_list != "")
        .group_by(Entry.custom_list)
        .order_by(desc(latest_updated), asc(Entry.custom_list))
    ).all()
    return [{"name": name, "count": count, "updated_at": updated_at} for name, count, updated_at in rows]


def rename_custom_list(db: Session, username: str, old_name: str, new_name: str) -> int:
    old_name = _normalise_custom_list(old_name)
    new_name = _normalise_custom_list(new_name)
    if old_name is None or new_name is None:
        return 0
    entries = db.query(Entry).filter(
        Entry.username == username,
        Entry.custom_list == old_name,
    ).all()
    now = datetime.now(timezone.utc)
    for entry in entries:
        entry.custom_list = new_name
        entry.updated_at = now
    db.commit()
    return len(entries)


def clear_custom_list(db: Session, username: str, list_name: str) -> int:
    list_name = _normalise_custom_list(list_name)
    if list_name is None:
        return 0
    entries = db.query(Entry).filter(
        Entry.username == username,
        Entry.custom_list == list_name,
    ).all()
    now = datetime.now(timezone.utc)
    for entry in entries:
        entry.custom_list = None
        entry.updated_at = now
    db.commit()
    return len(entries)


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
