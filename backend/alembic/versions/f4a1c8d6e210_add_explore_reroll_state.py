"""add explore reroll state

Adds ``reroll_failed`` / ``reroll_error`` to ``explore_cache`` so a failed
medium reroll can keep its previous recommendations and remember a
provider-specific error message until the user acts.

Also wipes every existing ``explore_cache`` row: the old cache used a suffixed
key scheme (``""`` for All, ``|n`` neutral, ``|L`` legacy, ``|s<hash>`` source)
and old rankings that the new per-medium model no longer reads. The cache is
fully rebuildable by rerolling, so a clean slate is simplest — users just see
the "Reroll all" prompt once.

Hand-written so the schema is explicit and the upgrade is idempotent on
partially-applied environments.

Revision ID: f4a1c8d6e210
Revises: e3a7c4f1b920
Create Date: 2026-06-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4a1c8d6e210"
down_revision: Union[str, Sequence[str], None] = "e3a7c4f1b920"
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


_TABLE_NAME = "explore_cache"


def _columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(_TABLE_NAME)}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _columns(bind)
    if "reroll_failed" not in cols:
        op.add_column(
            _TABLE_NAME,
            sa.Column(
                "reroll_failed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
    if "reroll_error" not in cols:
        op.add_column(
            _TABLE_NAME,
            sa.Column("reroll_error", sa.Text(), nullable=True),
        )
    # Clear stale rows keyed under the retired suffix scheme.
    op.execute(f"DELETE FROM {_TABLE_NAME}")


def downgrade() -> None:
    bind = op.get_bind()
    cols = _columns(bind)
    if "reroll_error" in cols:
        op.drop_column(_TABLE_NAME, "reroll_error")
    if "reroll_failed" in cols:
        op.drop_column(_TABLE_NAME, "reroll_failed")
