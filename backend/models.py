from datetime import datetime, timezone
from typing import Any
from sqlalchemy import Integer, String, Float, DateTime, Text, Boolean, JSON, func, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from db import Base

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    username: Mapped[str] = mapped_column(String(100), primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(128), nullable=False)
    # ── Settings ─────────────────────────────────────────────────────────────
    # backup_freq stays a real column: it is a backend concern, read by the
    # background backup scheduler. Everything else (library/explore/dashboard/
    # statistics prefs) lives in the single ui_preferences JSON document below.
    backup_freq:              Mapped[str] = mapped_column(String(20), nullable=False, server_default="never")
    # Timestamp of the last successful email backup (NULL = never run).
    last_backup_at:           Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    # Single JSON document holding ALL customizable UI preferences — library
    # (default mode/sort/per-page, columns, view toggles), dashboard (table
    # sizes/columns), statistics (sections + ranges), and explore (medium/bias/
    # personalize/hide-in-library). NULL is treated as "{}"; the app deep-merges
    # it over DEFAULT_UI. See schemas.DEFAULT_UI for the canonical shape.
    ui_preferences:           Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    def __repr__(self) -> str:
        return f"<User username={self.username!r} email={self.email!r}>"

class Entry(Base):
    __tablename__ = "entries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title:     Mapped[str]           = mapped_column(String(500), nullable=False, index=True)
    medium:    Mapped[str | None]    = mapped_column(String(100), nullable=True, index=True)
    origin:    Mapped[str | None]    = mapped_column(String(100), nullable=True, index=True)
    year:      Mapped[int | None]    = mapped_column(Integer,     nullable=True)
    cover_url: Mapped[str | None]    = mapped_column(String(1000),nullable=True)
    notes:     Mapped[str | None]    = mapped_column(Text,        nullable=True)
    external_id:     Mapped[str | None]   = mapped_column(String(200),  nullable=True)
    source:          Mapped[str | None]   = mapped_column(String(100),  nullable=True)
    external_url:    Mapped[str | None]   = mapped_column(String(1000), nullable=True)
    genres:          Mapped[str | None]   = mapped_column(String(500),  nullable=True)
    external_rating: Mapped[float | None] = mapped_column(Float,        nullable=True)
    custom_list:     Mapped[str | None]   = mapped_column(String(100),  nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="planned", index=True)
    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total:    Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at:   Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at:   Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=_utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    username: Mapped[str] = mapped_column(String(100), ForeignKey("users.username"), nullable=False, index=True)
    def __repr__(self) -> str:
        return f"<Entry id={self.id} title={self.title!r} status={self.status!r} username={self.username!r}>"


class ExploreCache(Base):
    """Per-(user, medium) cache of the latest Explore page results.

    `medium` is "" for the "All" sidebar tab. Items are stored as a JSON list
    of ExploreItem dicts in their already-ranked order. The Refresh button on
    the Explore page is the only way to invalidate a row — otherwise reads
    return the cached payload (with library titles re-filtered live).
    """
    __tablename__ = "explore_cache"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(
        String(100), ForeignKey("users.username", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    medium:     Mapped[str] = mapped_column(String(50), nullable=False, server_default="")
    items_json: Mapped[str] = mapped_column(Text, nullable=False)
    cached_at:  Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=_utcnow, nullable=False,
    )
    __table_args__ = (
        UniqueConstraint("username", "medium", name="uq_explore_cache_user_medium"),
    )
