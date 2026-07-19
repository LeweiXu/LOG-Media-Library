from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from models import Entry
from schemas import (
    BacklogBucket,
    MediumCompletion,
    MediumCount,
    MediumRatingComparison,
    MonthActivity,
    MonthCount,
    OriginCount,
    RatingBucket,
    ReleaseYearStat,
    StatsResponse,
    DashboardStatsResponse,
)


BACKLOG_BUCKETS = (
    ("under_3_months", "< 3 months", 0, 90),
    ("three_to_six_months", "3-6 months", 90, 180),
    ("six_to_twelve_months", "6-12 months", 180, 365),
    ("over_one_year", "1+ years", 365, None),
)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _month_key(value: datetime) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def _month_label(key: str) -> str:
    year, month = (int(part) for part in key.split("-"))
    labels = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    return f"{labels[month - 1]} {str(year)[-2:]}"


def _month_index(key: str) -> int:
    year, month = (int(part) for part in key.split("-"))
    return year * 12 + month - 1


def _key_from_month_index(value: int) -> str:
    year, month_zero = divmod(value, 12)
    return f"{year:04d}-{month_zero + 1:02d}"


def _average(values: list[float], digits: int = 2) -> float | None:
    return round(sum(values) / len(values), digits) if values else None


def _completion_streaks(completed_months: set[str], now: datetime) -> tuple[int, int]:
    if not completed_months:
        return 0, 0

    month_indexes = sorted({_month_index(key) for key in completed_months})
    longest = run = 0
    previous = None
    for month in month_indexes:
        run = run + 1 if previous is not None and month == previous + 1 else 1
        longest = max(longest, run)
        previous = month

    current_index = now.year * 12 + now.month - 1
    # An unfinished current month does not break a streak established last month.
    if current_index not in month_indexes:
        current_index -= 1
    current = 0
    month_set = set(month_indexes)
    while current_index in month_set:
        current += 1
        current_index -= 1
    return current, longest


def get_stats(db: Session, username: str, visible_mediums: set[str] | None = None) -> StatsResponse:
    entries = list(
        db.execute(
            select(Entry)
            .where(Entry.username == username)
            .order_by(Entry.id)
        ).scalars()
    )
    if visible_mediums is not None:
        entries = [
            entry for entry in entries
            if not entry.medium or entry.medium in visible_mediums
        ]
    now = datetime.now(timezone.utc)

    status_counts = Counter(entry.status for entry in entries)
    medium_counts = Counter(entry.medium for entry in entries if entry.medium)
    origin_counts = Counter(entry.origin for entry in entries if entry.origin)

    completed = [entry for entry in entries if entry.status == "completed"]
    completed_ratings = [float(entry.rating) for entry in completed if entry.rating is not None]
    all_ratings = [float(entry.rating) for entry in entries if entry.rating is not None]
    rated_completed = len(completed_ratings)

    by_medium = [
        MediumCount(medium=medium, count=count)
        for medium, count in medium_counts.most_common()
    ]
    by_origin = [
        OriginCount(origin=origin, count=count)
        for origin, count in origin_counts.most_common()
    ]

    rating_buckets: Counter[float] = Counter()
    for rating in completed_ratings:
        bucket = round(rating * 2) / 2
        if 0 <= bucket <= 10:
            rating_buckets[bucket] += 1
    rating_distribution = [
        RatingBucket(rating=rating, count=rating_buckets[rating])
        for rating in sorted(rating_buckets)
    ]

    monthly_added: Counter[str] = Counter()
    monthly_completed: Counter[str] = Counter()
    for entry in entries:
        created_at = _aware(entry.created_at)
        completed_at = _aware(entry.completed_at)
        if created_at:
            monthly_added[_month_key(created_at)] += 1
        if completed_at:
            monthly_completed[_month_key(completed_at)] += 1

    month_keys = set(monthly_added) | set(monthly_completed)
    activity_per_month: list[MonthActivity] = []
    if month_keys:
        start = min(_month_index(key) for key in month_keys)
        end = max(max(_month_index(key) for key in month_keys), now.year * 12 + now.month - 1)
        for month_index in range(start, end + 1):
            key = _key_from_month_index(month_index)
            activity_per_month.append(MonthActivity(
                key=key,
                label=_month_label(key),
                added=monthly_added[key],
                completed=monthly_completed[key],
            ))

    entries_per_month = [
        MonthCount(key=item.key, label=item.label, count=item.completed)
        for item in activity_per_month
        if item.completed
    ][-12:]

    resolved_by_medium = Counter(
        entry.medium
        for entry in entries
        if entry.medium and entry.status in {"completed", "dropped"}
    )
    completed_by_medium = Counter(
        entry.medium
        for entry in entries
        if entry.medium and entry.status == "completed"
    )
    completion_by_medium = []
    for medium, resolved_count in resolved_by_medium.most_common():
        completed_count = completed_by_medium[medium]
        completion_by_medium.append(MediumCompletion(
            medium=medium,
            total=resolved_count,
            completed=completed_count,
            rate=round(completed_count / resolved_count * 100, 1),
        ))

    planned = [entry for entry in entries if entry.status == "planned"]
    planned_ages: list[tuple[Entry, int]] = []
    backlog_counts = Counter()
    for entry in planned:
        created_at = _aware(entry.created_at)
        age_days = max(0, (now - created_at).days) if created_at else 0
        planned_ages.append((entry, age_days))
        for key, _, minimum, maximum in BACKLOG_BUCKETS:
            if age_days >= minimum and (maximum is None or age_days < maximum):
                backlog_counts[key] += 1
                break
    oldest_planned = max(planned_ages, key=lambda item: item[1], default=None)
    backlog_age = [
        BacklogBucket(key=key, label=label, count=backlog_counts[key])
        for key, label, _, _ in BACKLOG_BUCKETS
    ]

    active_progress = [
        min(max(float(entry.progress or 0) / float(entry.total), 0), 1) * 100
        for entry in entries
        if entry.status == "current" and entry.total and entry.total > 0
    ]

    matched_ratings: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for entry in entries:
        if (
            entry.medium
            and entry.rating is not None
            and entry.external_rating is not None
        ):
            matched_ratings[entry.medium].append(
                (float(entry.rating), float(entry.external_rating))
            )
    rating_comparison_by_medium = []
    for medium, pairs in matched_ratings.items():
        personal = _average([pair[0] for pair in pairs], 2)
        external = _average([pair[1] for pair in pairs], 2)
        rating_comparison_by_medium.append(MediumRatingComparison(
            medium=medium,
            personal=personal or 0,
            external=external or 0,
            difference=round((personal or 0) - (external or 0), 2),
            matched=len(pairs),
        ))
    rating_comparison_by_medium.sort(key=lambda item: (-item.matched, item.medium))

    release_year_groups: dict[int, list[Entry]] = defaultdict(list)
    for entry in entries:
        if entry.year:
            release_year_groups[entry.year].append(entry)
    release_years = []
    for year in sorted(release_year_groups):
        group = release_year_groups[year]
        ratings = [float(entry.rating) for entry in group if entry.rating is not None]
        release_years.append(ReleaseYearStat(
            year=year,
            count=len(group),
            avg_rating=_average(ratings, 2),
        ))

    current_streak, longest_streak = _completion_streaks(
        set(monthly_completed),
        now,
    )
    total = len(entries)
    completed_count = status_counts["completed"]
    resolved_count = completed_count + status_counts["dropped"]

    return StatsResponse(
        total=total,
        current=status_counts["current"],
        planned=status_counts["planned"],
        completed=completed_count,
        on_hold=status_counts["on_hold"],
        dropped=status_counts["dropped"],
        avg_rating=_average(completed_ratings, 2),
        avg_rating_all=_average(all_ratings, 2),
        by_medium=by_medium,
        by_origin=by_origin,
        entries_per_month=entries_per_month,
        completion_rate=round(completed_count / resolved_count * 100, 1) if resolved_count else 0,
        rating_coverage=round(rated_completed / completed_count * 100, 1) if completed_count else 0,
        average_active_progress=_average(active_progress, 1),
        oldest_planned_title=oldest_planned[0].title if oldest_planned else None,
        oldest_planned_days=oldest_planned[1] if oldest_planned else None,
        current_completion_streak=current_streak,
        longest_completion_streak=longest_streak,
        rating_distribution=rating_distribution,
        activity_per_month=activity_per_month,
        completion_by_medium=completion_by_medium,
        backlog_age=backlog_age,
        rating_comparison_by_medium=rating_comparison_by_medium,
        release_years=release_years,
    )


def get_dashboard_stats(
    db: Session,
    username: str,
    visible_mediums: set[str] | None = None,
) -> DashboardStatsResponse:
    """Return only the counts and recent activity used by Dashboard."""
    query = select(
        Entry.status,
        Entry.medium,
        Entry.origin,
        Entry.rating,
        Entry.completed_at,
    ).where(Entry.username == username)
    if visible_mediums is not None:
        query = query.where(or_(Entry.medium.is_(None), Entry.medium.in_(visible_mediums)))
    rows = db.execute(query).all()

    status_counts = Counter(row.status for row in rows)
    medium_counts = Counter(row.medium for row in rows if row.medium)
    origin_counts = Counter(row.origin for row in rows if row.origin)
    completed_ratings = [
        float(row.rating)
        for row in rows
        if row.status == "completed" and row.rating is not None
    ]
    monthly_completed: Counter[str] = Counter()
    for row in rows:
        completed_at = _aware(row.completed_at)
        if completed_at:
            monthly_completed[_month_key(completed_at)] += 1

    entries_per_month = [
        MonthCount(key=key, label=_month_label(key), count=count)
        for key, count in sorted(monthly_completed.items())
        if count
    ][-12:]

    return DashboardStatsResponse(
        total=len(rows),
        current=status_counts["current"],
        planned=status_counts["planned"],
        completed=status_counts["completed"],
        on_hold=status_counts["on_hold"],
        dropped=status_counts["dropped"],
        avg_rating=_average(completed_ratings, 2),
        by_medium=[
            MediumCount(medium=medium, count=count)
            for medium, count in medium_counts.most_common()
        ],
        by_origin=[
            OriginCount(origin=origin, count=count)
            for origin, count in origin_counts.most_common()
        ],
        entries_per_month=entries_per_month,
    )
