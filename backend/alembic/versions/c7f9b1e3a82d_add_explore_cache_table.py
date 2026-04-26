"""add explore_cache table

Caches the latest Explore page results per ``(username, medium)``. Filled
on first request for a medium and only invalidated when the user clicks
Refresh on the Explore page. ``medium`` is "" for the "All" sidebar tab.

Hand-written so the schema is explicit and the upgrade is idempotent on
partially-applied environments.

Revision ID: c7f9b1e3a82d
Revises: a4c81e7d2f10
Create Date: 2026-04-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7f9b1e3a82d"
down_revision: Union[str, Sequence[str], None] = "a4c81e7d2f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


_TABLE_NAME = "explore_cache"


def _table_exists(bind, name: str) -> bool:
    return name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, _TABLE_NAME):
        return

    op.create_table(
        _TABLE_NAME,
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "username",
            sa.String(length=100),
            sa.ForeignKey("users.username", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "medium",
            sa.String(length=50),
            nullable=False,
            server_default=sa.text("''"),
        ),
        sa.Column("items_json", sa.Text(), nullable=False),
        sa.Column(
            "cached_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "username", "medium", name="uq_explore_cache_user_medium",
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, _TABLE_NAME):
        return
    op.drop_table(_TABLE_NAME)
