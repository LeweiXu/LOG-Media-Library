"""Filesystem cover cache.

Covers from Cloudflare-protected, API-less sites (e.g. NovelUpdates) can't be
hotlinked cross-site by browsers or fetched server-side. Instead the browser
extension fetches the image first-party (where the user's `cf_clearance` is
valid) and uploads the raw bytes here; we store them keyed by a hash of the
original cover URL so any later request for that URL resolves to the same file.

This module only *stores* uploaded bytes (full JPEG + a thumbnail). Serving the
cached files back to the frontend is a separate, later concern.
"""
from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile

from PIL import Image, ImageOps, UnidentifiedImageError

from config import get_settings

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
