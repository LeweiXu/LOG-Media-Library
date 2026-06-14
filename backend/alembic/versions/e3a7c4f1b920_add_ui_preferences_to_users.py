"""consolidate user settings into a single ui_preferences JSON column

Adds a nullable ``ui_preferences`` JSON column on ``users`` and folds the old
scalar settings columns into it, then drops them:

    default_sort, default_entries_per_page  -> ui.library.{default_sort, entries_per_page}
    explore_default_medium                  -> ui.explore.default_medium
    explore_personalize                     -> ui.explore.personalize
    explore_hide_in_library                 -> ui.explore.hide_in_library
    explore_by                              -> ui.explore.by

``backup_freq`` and ``last_backup_at`` stay as real columns (backend concerns).

Hand-written and idempotent (guards on column existence) because Alembic
autogeneration is unreliable in this project.

Revision ID: e3a7c4f1b920
Revises: d2b5f76a2c31
Create Date: 2026-06-14
"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e3a7c4f1b920"
down_revision: Union[str, Sequence[str], None] = "d2b5f76a2c31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on:    Union[str, Sequence[str], None] = None


# old scalar column -> (sub-doc key, json key) mapping used for backfill.
_LIBRARY_COLS = {
    "default_sort": "default_sort",
    "default_entries_per_page": "entries_per_page",
}
_EXPLORE_COLS = {
    "explore_default_medium": "default_medium",
    "explore_personalize": "personalize",
    "explore_hide_in_library": "hide_in_library",
    "explore_by": "by",
}
_OLD_COLS = list(_LIBRARY_COLS) + list(_EXPLORE_COLS)


def _user_columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("users")}


def _as_dict(value) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    try:
        return json.loads(value) or {}
    except (TypeError, ValueError):
        return {}


def upgrade() -> None:
    bind = op.get_bind()
    cols = _user_columns(bind)

    if "ui_preferences" not in cols:
        op.add_column("users", sa.Column("ui_preferences", sa.JSON(), nullable=True))

    present = [c for c in _OLD_COLS if c in cols]
    if present:
        rows = bind.execute(
            sa.text(f"SELECT username, ui_preferences, {', '.join(present)} FROM users")
        ).mappings().all()
        for row in rows:
            library = {}
            explore = {}
            for col, key in _LIBRARY_COLS.items():
                if col in present and row[col] is not None:
                    library[key] = row[col]
            for col, key in _EXPLORE_COLS.items():
                if col in present and row[col] is not None:
                    explore[key] = row[col]
            backfill = {}
            if library:
                backfill["library"] = library
            if explore:
                backfill["explore"] = explore
            if not backfill:
                continue
            # Existing UI customizations win over the legacy scalar values.
            existing = _as_dict(row["ui_preferences"])
            merged = _deep_merge(backfill, existing)
            bind.execute(
                sa.text("UPDATE users SET ui_preferences = :doc WHERE username = :u"),
                {"doc": json.dumps(merged), "u": row["username"]},
            )

    for col in present:
        op.drop_column("users", col)


def downgrade() -> None:
    bind = op.get_bind()
    cols = _user_columns(bind)

    specs = {
        "default_sort": sa.Column("default_sort", sa.String(length=30), nullable=False, server_default="updated_at"),
        "default_entries_per_page": sa.Column("default_entries_per_page", sa.Integer(), nullable=False, server_default="40"),
        "explore_default_medium": sa.Column("explore_default_medium", sa.String(length=50), nullable=True),
        "explore_personalize": sa.Column("explore_personalize", sa.Boolean(), nullable=False, server_default="true"),
        "explore_hide_in_library": sa.Column("explore_hide_in_library", sa.Boolean(), nullable=False, server_default="true"),
        "explore_by": sa.Column("explore_by", sa.String(length=20), nullable=False, server_default="all"),
    }
    for name, column in specs.items():
        if name not in cols:
            op.add_column("users", column)

    # Best-effort: copy values back out of the JSON doc into the restored columns.
    if "ui_preferences" in cols:
        rows = bind.execute(sa.text("SELECT username, ui_preferences FROM users")).mappings().all()
        for row in rows:
            doc = _as_dict(row["ui_preferences"])
            library = doc.get("library", {}) or {}
            explore = doc.get("explore", {}) or {}
            updates, params = [], {"u": row["username"]}
            for col, key in _LIBRARY_COLS.items():
                if key in library and library[key] is not None:
                    updates.append(f"{col} = :{col}")
                    params[col] = library[key]
            for col, key in _EXPLORE_COLS.items():
                if key in explore and explore[key] is not None:
                    updates.append(f"{col} = :{col}")
                    params[col] = explore[key]
            if updates:
                bind.execute(sa.text(f"UPDATE users SET {', '.join(updates)} WHERE username = :u"), params)
        op.drop_column("users", "ui_preferences")


def _deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for key, value in (over or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out
