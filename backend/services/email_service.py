"""Stdlib SMTP sender — used by the periodic backup job.

The whole module is a thin wrapper around ``smtplib.SMTP`` + STARTTLS, which
is the shape Gmail / Outlook / iCloud all expect on port 587. There is no
queue or retry logic; the scheduler ticks hourly and a transient failure
will be retried on the next due tick.

See ``backend/BACKUP.md`` for setup instructions (creating an app password
on Gmail etc.) and the env vars consumed here.
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Iterable

from config import get_settings

logger = logging.getLogger(__name__)


class SMTPNotConfigured(RuntimeError):
    """Raised when something tries to send mail before SMTP_* env vars are set."""


def send_email(
    *,
    to:          str,
    subject:     str,
    body:        str,
    attachments: Iterable[tuple[str, bytes, str]] = (),
) -> None:
    """Send a single multipart email via the configured SMTP relay.

    ``attachments`` is an iterable of ``(filename, content_bytes, mime_subtype)``
    tuples — for the library backup we only ever pass one CSV.

    Raises ``SMTPNotConfigured`` if env is incomplete and ``smtplib`` errors
    propagate verbatim so the scheduler can log + skip the user.
    """
    s = get_settings()
    if not s.smtp_configured:
        raise SMTPNotConfigured(
            "SMTP_HOST / SMTP_USER / SMTP_PASSWORD must all be set in .env "
            "to send mail. See backend/BACKUP.md."
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"]    = s.smtp_from_address
    msg["To"]      = to
    msg["Message-ID"] = make_msgid()
    msg.set_content(body)

    for filename, data, subtype in attachments:
        msg.add_attachment(
            data,
            maintype="application",
            subtype=subtype,
            filename=filename,
        )

    context = ssl.create_default_context()
    # 465 is implicit TLS; everything else uses STARTTLS over a plain connection.
    if s.SMTP_PORT == 465:
        with smtplib.SMTP_SSL(s.SMTP_HOST, s.SMTP_PORT, context=context, timeout=30) as client:
            client.login(s.SMTP_USER, s.SMTP_PASSWORD)
            client.send_message(msg)
    else:
        with smtplib.SMTP(s.SMTP_HOST, s.SMTP_PORT, timeout=30) as client:
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
            client.login(s.SMTP_USER, s.SMTP_PASSWORD)
            client.send_message(msg)

    logger.info("Sent email to %s (subject=%r, attachments=%d)",
                to, subject, sum(1 for _ in attachments) if isinstance(attachments, list) else -1)


# Helper kept here so callers don't have to remember the formatting.
def format_sender(display_name: str, email: str) -> str:
    return formataddr((display_name, email))
