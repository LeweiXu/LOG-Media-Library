from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import func, select, case
from sqlalchemy.orm import Session

from models import Entry
from schemas import StatsResponse, MediumCount, OriginCount, MonthCount


def get_stats(db: Session, username: str) -> StatsResponse:
    # ── Status counts ─────────────────────────────────────────────────────────
    status_rows = db.execute(
        select(Entry.status, func.count().label("cnt"))
        .where(Entry.username == username)
        .group_by(Entry.status)
    ).all()

    status_map: dict[str, int] = defaultdict(int)
    for row in status_rows:
        status_map[row.status] = row.cnt

    total = sum(status_map.values())

    # ── Average rating (completed entries only) ───────────────────────────────
    avg_rating_row = db.execute(
        select(func.avg(Entry.rating))
        .where(Entry.username == username)
        .where(Entry.status == "completed")
        .where(Entry.rating.is_not(None))
    ).scalar_one_or_none()

    avg_rating = round(float(avg_rating_row), 2) if avg_rating_row is not None else None

    # ── By medium ─────────────────────────────────────────────────────────────
    medium_rows = db.execute(
        select(Entry.medium, func.count().label("cnt"))
        .where(Entry.username == username)
        .where(Entry.medium.is_not(None))
        .group_by(Entry.medium)
        .order_by(func.count().desc())
    ).all()

    by_medium = [MediumCount(medium=r.medium, count=r.cnt) for r in medium_rows]

    # ── By origin ─────────────────────────────────────────────────────────────
    origin_rows = db.execute(
        select(Entry.origin, func.count().label("cnt"))
        .where(Entry.username == username)
        .where(Entry.origin.is_not(None))
        .group_by(Entry.origin)
        .order_by(func.count().desc())
    ).all()

    by_origin = [OriginCount(origin=r.origin, count=r.cnt) for r in origin_rows]

    # ── Consumed per month (last 12 months, based on completed_at) ──────────────
    month_rows = db.execute(
        select(
            func.to_char(Entry.completed_at, "YYYY-MM").label("key"),
            func.to_char(Entry.completed_at, "Mon YY").label("label"),
            func.count().label("cnt"),
        )
        .where(Entry.username == username)
        .where(Entry.completed_at.is_not(None))
        .group_by(
            func.to_char(Entry.completed_at, "YYYY-MM"),
            func.to_char(Entry.completed_at, "Mon YY"),
        )
        .order_by(func.to_char(Entry.completed_at, "YYYY-MM").desc())
        .limit(12)
    ).all()

    entries_per_month = [
        MonthCount(key=r.key, label=r.label.strip(), count=r.cnt)
        for r in reversed(month_rows)
    ]

    return StatsResponse(
        total=total,
        current=status_map["current"],
        planned=status_map["planned"],
        completed=status_map["completed"],
        on_hold=status_map["on_hold"],
        dropped=status_map["dropped"],
        avg_rating=avg_rating,
        by_medium=by_medium,
        by_origin=by_origin,
        entries_per_month=entries_per_month,
    )
