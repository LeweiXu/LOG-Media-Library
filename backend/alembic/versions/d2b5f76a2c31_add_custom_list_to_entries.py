"""add custom_list to entries

Adds a nullable indexed ``custom_list`` column to ``entries``. This is
hand-written because Alembic autogeneration is unreliable in this project.

Revision ID: d2b5f76a2c31
Revises: b8d4e2c91a05
Create Date: 2026-05-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d2b5f76a2c31"
down_revision: Union[str, Sequence[str], None] = "b8d4e2c91a05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


_COLUMN_NAME = "custom_list"
_INDEX_NAME = "ix_entries_custom_list"


def _entry_columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("entries")}


def _entry_indexes(bind) -> set[str]:
    return {i["name"] for i in sa.inspect(bind).get_indexes("entries")}


def upgrade() -> None:
    bind = op.get_bind()
    if _COLUMN_NAME not in _entry_columns(bind):
        op.add_column(
            "entries",
            sa.Column(_COLUMN_NAME, sa.String(length=100), nullable=True),
        )
    if _INDEX_NAME not in _entry_indexes(bind):
        op.create_index(_INDEX_NAME, "entries", [_COLUMN_NAME], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    if _INDEX_NAME in _entry_indexes(bind):
        op.drop_index(_INDEX_NAME, table_name="entries")
    if _COLUMN_NAME in _entry_columns(bind):
        op.drop_column("entries", _COLUMN_NAME)
