"""Periodic email backup of each user's library CSV.

Two entry points:

  * ``run_backup_for_user(db, user)`` — exports the user's library to CSV,
    emails it as an attachment to ``user.email``, and stamps
    ``user.last_backup_at``. Used both by the manual ``POST /backup/run``
    endpoint and by the scheduler.

  * ``tick_due_backups(db)`` — scans every user with ``backup_freq != 'never'``
    and runs a backup for those whose ``last_backup_at`` is older than the
    interval implied by their frequency. Idempotent: safe to call as often
    as you like; users that aren't due are skipped.

The scheduler in ``main.py`` calls ``tick_due_backups`` once per
``BACKUP_TICK_SECONDS`` (default: 1 hour). One global tick + a per-user
"is it due?" check is much simpler than per-user timers and survives
process restarts gracefully (no in-memory schedule to rebuild).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from models import User
from services.email_service import send_email, SMTPNotConfigured
from services.export_service import export_entries_csv

logger = logging.getLogger(__name__)


# Per-frequency frequency. Anything older than this is "due".
_INTERVALS: dict[str, timedelta] = {
    "daily":   timedelta(days=1),
    "weekly":  timedelta(days=7),
    "monthly": timedelta(days=30),
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def is_backup_due(user: User, *, now: datetime | None = None) -> bool:
    """Return True iff ``user`` should receive a backup right now."""
    freq = (user.backup_freq or "never").lower()
    if freq == "never":
        return False
    interval = _INTERVALS.get(freq)
    if interval is None:
        return False
    if user.last_backup_at is None:
        return True
    last = user.last_backup_at
    # Older Postgres rows can come back naive; treat them as UTC.
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return (now or _utcnow()) - last >= interval


def run_backup_for_user(db: Session, user: User) -> datetime:
    """Generate the CSV, email it, and persist ``last_backup_at``.

    Returns the new ``last_backup_at``. Raises ``SMTPNotConfigured`` if the
    server has no SMTP relay configured, or any ``smtplib`` error if the
    relay rejects the message.
    """
    csv_text = export_entries_csv(db, user.username)
    csv_bytes = csv_text.encode("utf-8")
    when = _utcnow()
    filename = f"library_{user.username}_{when.strftime('%Y-%m-%d')}.csv"

    body = (
        f"Hello {user.username},\n\n"
        f"Attached is your latest LOG library backup ({when.strftime('%Y-%m-%d %H:%M UTC')}).\n"
        f"Your account is set to back up on a {user.backup_freq} frequency — change that "
        f"or stop backups any time from the Settings panel.\n\n"
        f"— LOGARIUM\n"
    )

    send_email(
        to=user.email,
        subject=f"LOG library backup — {when.strftime('%Y-%m-%d')}",
        body=body,
        attachments=[(filename, csv_bytes, "csv")],
    )

    user.last_backup_at = when
    db.commit()
    return when


def tick_due_backups(db: Session) -> int:
    """Run a backup for every user whose schedule says they are due.

    Returns the number of successful backups. Failures are logged and the
    user's ``last_backup_at`` is left untouched so the next tick retries.
    """
    now = _utcnow()
    users = db.execute(
        select(User).where(User.backup_freq != "never")
    ).scalars().all()

    succeeded = 0
    for user in users:
        if not is_backup_due(user, now=now):
            continue
        try:
            run_backup_for_user(db, user)
            succeeded += 1
        except SMTPNotConfigured:
            # No point continuing — the relay isn't configured for any user.
            logger.warning(
                "Skipping backup tick: SMTP not configured. See backend/BACKUP.md."
            )
            return succeeded
        except Exception as exc:
            # Roll back any partial state but leave last_backup_at untouched
            # so the user remains "due" and we'll retry on the next tick.
            db.rollback()
            logger.exception("Backup failed for user %r: %s", user.username, exc)
    return succeeded
