from datetime import datetime, timezone
from sqlalchemy import Integer, String, Float, DateTime, Text, Boolean, func, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from db import Base

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    username: Mapped[str] = mapped_column(String(100), primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(128), nullable=False)
    # ── Settings (added 2026-04-25) ──────────────────────────────────────────
    # Library/backup settings — UI for these lands in a later change.
    backup_freq:              Mapped[str] = mapped_column(String(20), nullable=False, server_default="never")
    default_sort:             Mapped[str] = mapped_column(String(30), nullable=False, server_default="updated_at")
    default_entries_per_page: Mapped[int] = mapped_column(Integer,    nullable=False, server_default="40")
    # Explore-page preferences.
    explore_default_medium:   Mapped[str | None] = mapped_column(String(50), nullable=True)
    explore_personalize:      Mapped[bool]       = mapped_column(Boolean,    nullable=False, server_default="true")
    explore_hide_in_library:  Mapped[bool]       = mapped_column(Boolean,    nullable=False, server_default="true")
    # Which dimension the Explore page biases toward — "all" / "genre" / "medium" / "origin".
    explore_by:               Mapped[str]        = mapped_column(String(20), nullable=False, server_default="all")
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
