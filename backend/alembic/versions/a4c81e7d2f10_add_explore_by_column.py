"""add explore_by column to users

Adds a single new column to the ``users`` table:

  * explore_by — which dimension the Explore page biases recommendations
                 toward. One of ``all`` / ``genre`` / ``medium`` / ``origin``.
                 Default ``all`` (mixed bias = previous behaviour).

Hand-written so the server-side default is explicit and the upgrade is
idempotent on partially-applied environments.

Revision ID: a4c81e7d2f10
Revises: f152a6554320
Create Date: 2026-04-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4c81e7d2f10"
down_revision: Union[str, Sequence[str], None] = "f152a6554320"
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


_NEW_COLUMN = sa.Column(
    "explore_by",
    sa.String(length=20),
    nullable=False,
    server_default=sa.text("'all'"),
)


def _existing_user_columns(bind) -> set[str]:
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns("users")}


def upgrade() -> None:
    bind = op.get_bind()
    if _NEW_COLUMN.name in _existing_user_columns(bind):
        return
    op.add_column("users", _NEW_COLUMN)


def downgrade() -> None:
    bind = op.get_bind()
    if _NEW_COLUMN.name not in _existing_user_columns(bind):
        return
    op.drop_column("users", _NEW_COLUMN.name)
