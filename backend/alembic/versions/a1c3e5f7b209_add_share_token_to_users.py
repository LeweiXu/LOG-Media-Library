"""add share token to users

Revision ID: a1c3e5f7b209
Revises: 4c2e1a8b7d90
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1c3e5f7b209"
down_revision: Union[str, Sequence[str], None] = "4c2e1a8b7d90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NULL = sharing off. Tokens are issued on demand from the Console, so
    # nothing is backfilled here: every existing user starts with sharing off.
    op.add_column("users", sa.Column("share_token", sa.String(length=64), nullable=True))
    op.create_index("ix_users_share_token", "users", ["share_token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_share_token", table_name="users")
    op.drop_column("users", "share_token")
