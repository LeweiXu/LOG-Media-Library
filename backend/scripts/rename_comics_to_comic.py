#!/usr/bin/env python3
"""
Rename existing Entry.medium values from "Comics" to "Comic".

Usage from the server backend/ directory:
    python scripts/rename_comics_to_comic.py
    python scripts/rename_comics_to_comic.py --dry-run
"""
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(BACKEND_DIR / ".env")

from db import SessionLocal  # noqa: E402
from models import Entry  # noqa: E402


def rename_comics_to_comic(dry_run: bool = False) -> None:
    db = SessionLocal()
    try:
        entries = db.query(Entry).filter(Entry.medium == "Comics").all()
        if not entries:
            print('No entries with medium "Comics" found.')
            return

        print(f'Found {len(entries)} entries with medium "Comics".')
        if dry_run:
            print("[DRY RUN] No changes will be committed.\n")

        for entry in entries:
            print(f"  [{entry.id}] {entry.title!r}: Comics -> Comic")
            if not dry_run:
                entry.medium = "Comic"

        if dry_run:
            print(f"\n[DRY RUN] Would have updated {len(entries)} entries.")
        else:
            db.commit()
            print(f"\nCommitted {len(entries)} updates.")
    finally:
        db.close()


if __name__ == "__main__":
    rename_comics_to_comic(dry_run="--dry-run" in sys.argv)
