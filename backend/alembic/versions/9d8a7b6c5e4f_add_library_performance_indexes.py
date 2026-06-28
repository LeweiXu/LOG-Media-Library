"""add library performance indexes

Adds user-scoped composite indexes for Library filters and sorts. The existing
single-column indexes help small tables, but Library queries are always scoped
to one user and can grow to thousands of entries.

Revision ID: 9d8a7b6c5e4f
Revises: f4a1c8d6e210
Create Date: 2026-06-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9d8a7b6c5e4f"
down_revision: Union[str, Sequence[str], None] = "f4a1c8d6e210"
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


_TABLE_NAME = "entries"
_INDEXES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ix_entries_user_updated_at", ("username", "updated_at")),
    ("ix_entries_user_completed_at", ("username", "completed_at")),
    ("ix_entries_user_title", ("username", "title")),
    ("ix_entries_user_rating", ("username", "rating")),
    ("ix_entries_user_year", ("username", "year")),
    ("ix_entries_user_status", ("username", "status")),
    ("ix_entries_user_medium", ("username", "medium")),
    ("ix_entries_user_origin", ("username", "origin")),
    ("ix_entries_user_custom_list", ("username", "custom_list")),
    ("ix_entries_user_external_url", ("username", "external_url")),
)


def _index_names(bind) -> set[str]:
    return {i["name"] for i in sa.inspect(bind).get_indexes(_TABLE_NAME)}


def _column_names(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(_TABLE_NAME)}


def upgrade() -> None:
    bind = op.get_bind()
    existing = _index_names(bind)
    columns_present = _column_names(bind)
    for name, columns in _INDEXES:
        if name not in existing and set(columns).issubset(columns_present):
            op.create_index(name, _TABLE_NAME, list(columns), unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    existing = _index_names(bind)
    for name, _columns in reversed(_INDEXES):
        if name in existing:
            op.drop_index(name, table_name=_TABLE_NAME)
