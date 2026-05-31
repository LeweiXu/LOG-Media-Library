"""Filesystem cover cache.

Covers are stored keyed by a hash of the original cover URL, so any later
request for that URL resolves to the same file. Bytes reach the cache two ways:

  * **Server-side fetch** (`fetch_and_store_cover`) — the backend downloads the
    image itself via curl_cffi. Works for ordinary CDNs; Cloudflare-gated hosts
    (NovelUpdates) reject it.
  * **Extension upload** (`store_cover_bytes`) — the browser extension fetches
    the image first-party (where the user's `cf_clearance` is valid) and uploads
    the raw bytes, covering the Cloudflare case the server can't reach.

Cached files are served back only as an `onError` fallback (see `/covers/full`).
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import logging
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urlparse

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import get_settings
from models import Entry

logger = logging.getLogger(__name__)

settings = get_settings()

# Refuse uploads larger than this — covers are small; anything bigger is abuse.
MAX_SOURCE_BYTES = 12 * 1024 * 1024


class CoverCacheError(Exception):
    """Raised when an uploaded payload can't be processed into a cached cover."""


def cover_cache_key(cover_url: str) -> str:
    return hashlib.sha256(cover_url.encode("utf-8")).hexdigest()


def _cover_cache_dir(kind: str) -> Path:
    return Path(settings.COVER_CACHE_DIR).expanduser() / kind


def thumbnail_cache_path(cover_url: str) -> Path:
    return _cover_cache_dir("thumbnails") / f"{cover_cache_key(cover_url)}.jpg"


def full_cover_cache_path(cover_url: str) -> Path:
    return _cover_cache_dir("full") / f"{cover_cache_key(cover_url)}.jpg"


def store_cover_bytes(cover_url: str, raw: bytes) -> None:
    """Decode `raw` as an image and write the full cover + thumbnail to cache.

    Raises CoverCacheError if the payload isn't a decodable image. Writes are
    atomic (temp file + replace) so a cached path is never half-written.
    """
    if not raw:
        raise CoverCacheError("Empty cover upload")
    if len(raw) > MAX_SOURCE_BYTES:
        raise CoverCacheError("Cover image is too large")

    full_path = full_cover_cache_path(cover_url)
    thumbnail_path = thumbnail_cache_path(cover_url)

    try:
        image = _load_cover_image(raw)
        _write_jpeg(image, full_path, quality=82)

        thumbnail = image.copy()
        thumbnail.thumbnail(
            (settings.COVER_THUMBNAIL_WIDTH, settings.COVER_THUMBNAIL_HEIGHT),
            Image.Resampling.LANCZOS,
        )
        _write_jpeg(thumbnail, thumbnail_path, quality=72)
    except (OSError, UnidentifiedImageError) as exc:
        raise CoverCacheError("Failed to process cover image") from exc


def is_cover_cached(cover_url: str) -> bool:
    return full_cover_cache_path(cover_url).exists()


def _is_safe_cover_url(url: str) -> bool:
    """Reject non-http(s) and obvious internal targets (basic SSRF guard)."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host or host == "localhost" or host.endswith(".localhost"):
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return True  # a hostname (resolves to a public CDN) — fine
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved)


def fetch_cover_bytes(cover_url: str) -> bytes:
    """Download a cover server-side with Chrome impersonation. Blocking.

    Raises CoverCacheError on any failure (bad URL, network error, non-image,
    oversize) so callers can record it as a per-cover failure.
    """
    if not _is_safe_cover_url(cover_url):
        raise CoverCacheError("Unsupported cover URL")

    from curl_cffi import requests as cffi_requests

    try:
        resp = cffi_requests.get(cover_url, timeout=15, impersonate="chrome")
        resp.raise_for_status()
    except Exception as exc:  # curl_cffi raises a variety of error types
        raise CoverCacheError(f"fetch failed: {exc}") from exc

    content_type = (resp.headers.get("content-type") or "").lower()
    if not content_type.startswith("image/"):
        raise CoverCacheError(f"not an image ({content_type or 'unknown type'})")

    raw = resp.content
    if len(raw) > MAX_SOURCE_BYTES:
        raise CoverCacheError("Cover image is too large")
    return raw


def fetch_and_store_cover(cover_url: str) -> None:
    """Server-side fetch + cache a single cover. Blocking; raises CoverCacheError."""
    store_cover_bytes(cover_url, fetch_cover_bytes(cover_url))


async def cache_uncached_covers(db: Session, username: str):
    """SSE generator: server-side cache every not-yet-cached cover for a user.

    Yields {"type": "start"/"progress"/"done", …} dicts. Covers already on disk
    are skipped; the blocking fetch runs in a thread so the event loop stays
    responsive. Cloudflare-gated covers (NovelUpdates) fail here and are counted
    as `failed` — those need the browser extension's first-party caching.
    """
    rows = db.execute(
        select(Entry.cover_url).where(
            Entry.username == username,
            Entry.cover_url.is_not(None),
            Entry.cover_url != "",
        )
    ).scalars().all()

    # One entry per distinct URL — many entries can share a cover.
    urls = list(dict.fromkeys(u for u in rows if u))
    total = len(urls)
    yield {"type": "start", "total": total}

    cached = skipped = failed = processed = 0
    loop = asyncio.get_event_loop()

    for url in urls:
        processed += 1
        if is_cover_cached(url):
            skipped += 1
            status = "skip"
        else:
            try:
                await loop.run_in_executor(None, fetch_and_store_cover, url)
                cached += 1
                status = "cached"
            except CoverCacheError as exc:
                failed += 1
                status = "failed"
                logger.info("cover cache miss for %s: %s", url, exc)

        yield {
            "type": "progress", "processed": processed, "total": total,
            "cached": cached, "skipped": skipped, "failed": failed, "status": status,
        }

    yield {
        "type": "done", "total": total,
        "cached": cached, "skipped": skipped, "failed": failed,
    }


def _load_cover_image(source_bytes: bytes) -> Image.Image:
    with Image.open(BytesIO(source_bytes)) as image:
        return ImageOps.exif_transpose(image).convert("RGB")


def _write_jpeg(image: Image.Image, path: Path, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None

    try:
        with NamedTemporaryFile(dir=path.parent, suffix=".jpg", delete=False) as tmp:
            tmp_path = Path(tmp.name)
            image.save(tmp, format="JPEG", quality=quality, optimize=True, progressive=True)
    except OSError:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise

    tmp_path.replace(path)
