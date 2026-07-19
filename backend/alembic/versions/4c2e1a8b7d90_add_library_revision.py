"""add library revision

Revision ID: 4c2e1a8b7d90
Revises: 9d8a7b6c5e4f
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "4c2e1a8b7d90"
down_revision: Union[str, Sequence[str], None] = "9d8a7b6c5e4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("library_revision", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "library_revision")
