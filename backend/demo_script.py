"""
Copies all entries from user 'lingwei' to user 'demo_user'.
Steps:
  1. Delete all existing entries for 'demo_user'
  2. For each entry belonging to 'lingwei', insert a copy with username='demo_user'

Run directly:   python demo_script.py
Schedule via cron (see README or comments below).
"""

import sys
import os
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

settings = get_settings()
DATABASE_URL = settings.DATABASE_URL

SOURCE_USER = "lingwei"
DEST_USER = "demo_user"

# Columns to copy from entries (excludes 'id' so the DB assigns a new PK,
# and overrides 'username').
ENTRY_COLUMNS = [
    "title", "medium", "origin", "year", "cover_url", "notes",
    "external_id", "source", "external_url", "genres", "external_rating",
    "status", "rating", "progress", "total",
    "created_at", "updated_at", "completed_at",
]


def sync_demo_entries(db_url: str) -> None:
    engine = create_engine(db_url, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)

    with Session() as session:
        with session.begin():
            # 1. Delete all demo_user entries
            result = session.execute(
                text("DELETE FROM entries WHERE username = :u"),
                {"u": DEST_USER},
            )
            log.info("Deleted %d existing entries for '%s'.", result.rowcount, DEST_USER)

            # 2. Copy lingwei's entries to demo_user
            cols = ", ".join(ENTRY_COLUMNS)
            result = session.execute(
                text(
                    f"INSERT INTO entries ({cols}, username) "
                    f"SELECT {cols}, :dest FROM entries WHERE username = :src"
                ),
                {"dest": DEST_USER, "src": SOURCE_USER},
            )
            log.info("Copied %d entries from '%s' to '%s'.", result.rowcount, SOURCE_USER, DEST_USER)


if __name__ == "__main__":
    try:
        sync_demo_entries(DATABASE_URL)
        log.info("Done.")
    except Exception as exc:
        log.error("Failed: %s", exc)
        sys.exit(1)
