#!/usr/bin/env python3
"""
Warm the 3-size cover cache for every cover URL in the Entry table.

For each distinct cover_url (across all users):
  * skip   — all 3 sizes already cached
  * reused — an existing full/ file (legacy native cover, incl. Cloudflare/NU
             covers uploaded by the extension) is rebuilt into the 3 sizes with
             no network
  * cached — downloaded server-side via curl_cffi
  * failed — no cached bytes and the fetch failed (e.g. Cloudflare-gated with
             nothing in the cache yet — needs the extension's Resync Covers)

Run once after deploying the 3-size cover change.

Usage:
    python scripts/cache_all_covers.py [--clean-legacy-thumbnails]

    --clean-legacy-thumbnails  remove the orphaned pre-migration thumbnails/ dir
"""

import os
import sys

# Allow running from the backend/ directory.
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from config import get_settings
from db import SessionLocal
from models import Entry
from services.cover_cache_service import CoverCacheError, _cover_cache_dir, cache_one_cover


def main(clean_legacy: bool = False) -> None:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Entry.cover_url).where(
                Entry.cover_url.is_not(None),
                Entry.cover_url != "",
            )
        ).scalars().all()
    finally:
        db.close()

    urls = list(dict.fromkeys(u for u in rows if u))
    total = len(urls)
    print(f"{total} distinct cover URLs to process.\n")

    tally = {"skip": 0, "reused": 0, "cached": 0, "failed": 0}
    for i, url in enumerate(urls, 1):
        try:
            status = cache_one_cover(url)
        except CoverCacheError as exc:
            status = "failed"
            print(f"  [{i}/{total}] FAILED  {url}\n            {exc}")
        tally[status] += 1
        if status != "failed":
            print(f"  [{i}/{total}] {status:6s}  {url}")

    print(
        f"\nDone. skipped={tally['skip']} reused={tally['reused']} "
        f"fetched={tally['cached']} failed={tally['failed']}"
    )
    if tally["failed"]:
        print("Failed covers are likely Cloudflare-gated (NovelUpdates) with no cached "
              "bytes — run the extension's 'Resync Covers' to upload those first-party.")

    if clean_legacy:
        _clean_legacy_thumbnails()


def _clean_legacy_thumbnails() -> None:
    """Remove the pre-migration thumbnails/ dir (96x144), now superseded by thumb/."""
    legacy = _cover_cache_dir("thumbnails")
    if not legacy.exists():
        print("\nNo legacy thumbnails/ dir to clean.")
        return
    removed = 0
    for f in legacy.glob("*.jpg"):
        f.unlink(missing_ok=True)
        removed += 1
    try:
        legacy.rmdir()
    except OSError:
        pass
    print(f"\nRemoved {removed} orphaned legacy thumbnails from {legacy}.")


if __name__ == "__main__":
    get_settings()  # validate config early
    main(clean_legacy="--clean-legacy-thumbnails" in sys.argv)
