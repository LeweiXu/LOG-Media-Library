"""Filesystem cover cache.

Every source cover is cached at 3 fixed sizes, each tuned to a display box and
center-cropped (`ImageOps.fit`, upscaling smaller sources) so it fills the box
with no extra pixels:

  * **thumb**  (56x80)   — every table row (`.cover-thumb`)
  * **medium** (184x264) — Explore cards (`.explore-cover`)
  * **full**   (400x600) — entry detail modal, uniform for every cover

We keep only these 3, never the original. Files are keyed by a hash of the source
URL, so any later request resolves to the same files. Bytes reach the cache two
ways:

  * **Server-side fetch** (`fetch_and_store_cover`) — the backend downloads the
    image itself via curl_cffi. Works for ordinary CDNs; Cloudflare-gated hosts
    (NovelUpdates) reject it.
  * **Extension upload** (`store_cover_bytes`) — the browser extension fetches
    the image first-party (where the user's `cf_clearance` is valid) and uploads
    the raw bytes, covering the Cloudflare case the server can't reach.

The sized files are served proactively: tables/Explore via a bundled base64
response (`POST /covers/bundle`), the modal via `GET /covers/img`.
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

# The 3 cached tiers: name -> (width, height, jpeg quality). Dimensions come from
# config so they can be tuned without touching code.
SIZES: dict[str, tuple[int, int, int]] = {
    "thumb":  (settings.COVER_THUMB_W,  settings.COVER_THUMB_H,  70),
    "medium": (settings.COVER_MEDIUM_W, settings.COVER_MEDIUM_H, 80),
    "full":   (settings.COVER_FULL_W,   settings.COVER_FULL_H,   85),
}


class CoverCacheError(Exception):
    """Raised when an uploaded payload can't be processed into a cached cover."""


def cover_cache_key(cover_url: str) -> str:
    return hashlib.sha256(cover_url.encode("utf-8")).hexdigest()


def _cover_cache_dir(kind: str) -> Path:
    return Path(settings.COVER_CACHE_DIR).expanduser() / kind


def sized_cover_path(cover_url: str, size: str) -> Path:
    if size not in SIZES:
        raise CoverCacheError(f"Unknown cover size: {size}")
    return _cover_cache_dir(size) / f"{cover_cache_key(cover_url)}.jpg"


# The native-resolution original, kept alongside the 3 display sizes. It's never
# served — it exists only so we can regenerate the display sizes later (e.g. if
# their dimensions change) without re-downloading, which matters for Cloudflare/NU
# covers the server can't refetch. Cheap to keep; space is inconsequential.
def original_cover_path(cover_url: str) -> Path:
    return _cover_cache_dir("original") / f"{cover_cache_key(cover_url)}.jpg"


def store_cover_bytes(cover_url: str, raw: bytes) -> None:
    """Decode `raw` and write the native original + all 3 sized covers to cache.

    Each display tier is fit-cropped to its exact box (upscaling smaller sources)
    so it fills the display with no wasted pixels; the original is kept at native
    resolution for later regeneration. Raises CoverCacheError if the payload isn't
    a decodable image. Writes are atomic so a cached path is never half-written.
    """
    if not raw:
        raise CoverCacheError("Empty cover upload")
    if len(raw) > MAX_SOURCE_BYTES:
        raise CoverCacheError("Cover image is too large")

    try:
        image = _load_cover_image(raw)
        _write_jpeg(image, original_cover_path(cover_url), quality=90)
        for size, (width, height, quality) in SIZES.items():
            fitted = ImageOps.fit(image, (width, height), Image.Resampling.LANCZOS)
            _write_jpeg(fitted, sized_cover_path(cover_url, size), quality=quality)
    except (OSError, UnidentifiedImageError) as exc:
        raise CoverCacheError("Failed to process cover image") from exc


def is_cover_cached(cover_url: str) -> bool:
    """Cached only when all 3 display sizes are present (the original is a bonus)."""
    return all(sized_cover_path(cover_url, size).exists() for size in SIZES)


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


def cache_one_cover(cover_url: str, force: bool = False) -> str:
    """Ensure all 3 sizes exist for `cover_url`. Blocking; raises CoverCacheError.

    Returns 'skip' (already cached), 'reused' (rebuilt the sizes from bytes we
    already have — no network, covers Cloudflare/NU which we can't refetch), or
    'cached' (downloaded server-side).

    `force` rebuilds the sizes even when already cached — use it after changing a
    tier's dimensions so existing caches are regenerated (from the kept original,
    so it stays offline).
    """
    if not force and is_cover_cached(cover_url):
        return "skip"
    # Any bytes we already have are a usable source, best quality first: the kept
    # native original, then a legacy full/ file (native pre-migration, else the
    # current display full).
    for source in (original_cover_path(cover_url), sized_cover_path(cover_url, "full")):
        if source.exists():
            store_cover_bytes(cover_url, source.read_bytes())
            return "reused"
    fetch_and_store_cover(cover_url)
    return "cached"


async def cache_uncached_covers(db: Session, username: str):
    """SSE generator: server-side cache every not-yet-cached cover for a user.

    Yields {"type": "start"/"progress"/"done", …} dicts. Covers already fully
    cached are skipped; a cover with an existing full/ file is rebuilt into the 3
    sizes with no network (reused); anything else is fetched server-side. The
    blocking work runs in a thread so the event loop stays responsive.
    Cloudflare-gated covers (NovelUpdates) with no cached bytes fail here and are
    counted as `failed` — those need the browser extension's first-party caching.
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
        try:
            status = await loop.run_in_executor(None, cache_one_cover, url)
            if status == "skip":
                skipped += 1
            else:  # 'cached' or 'reused' — both mean it's now on disk
                cached += 1
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
