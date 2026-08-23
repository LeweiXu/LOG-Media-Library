"""Read-only profile sharing.

One link per user. The link carries an opaque ``shr_``-prefixed token that the
API accepts anywhere a bearer token is accepted: it resolves to the owning user,
so every existing read endpoint serves that user's data unchanged. Writes are
refused for share tokens by the guard in ``main.py`` (see ``is_share_token``).

Coarse by design: a user has at most one valid token at a time. Regenerating
issues a new one, which is what revokes the old link; disabling clears it.
"""
from __future__ import annotations

import secrets
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import User

SHARE_TOKEN_PREFIX = "shr_"


def is_share_token(token: Optional[str]) -> bool:
    return bool(token) and token.startswith(SHARE_TOKEN_PREFIX)


def _new_token() -> str:
    return f"{SHARE_TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def resolve(db: Session, token: str) -> Optional[User]:
    """Return the user a share token belongs to, or None if it isn't valid."""
    if not is_share_token(token):
        return None
    return db.execute(
        select(User).where(User.share_token == token)
    ).scalar_one_or_none()


def get_token(user: User) -> Optional[str]:
    """The user's current token, or None when sharing is off."""
    return user.share_token


def regenerate(db: Session, user: User) -> str:
    """Issue a fresh token, invalidating any previous link."""
    user.share_token = _new_token()
    db.commit()
    db.refresh(user)
    return user.share_token


def enable(db: Session, user: User) -> str:
    """Turn sharing on, keeping the existing token if there already is one."""
    if user.share_token:
        return user.share_token
    return regenerate(db, user)


def disable(db: Session, user: User) -> None:
    """Turn sharing off. Any existing link stops working immediately."""
    user.share_token = None
    db.commit()
