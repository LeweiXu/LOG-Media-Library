from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import get_settings
from db import SessionLocal, engine, Base
from models import Entry, ExploreCache, User  # noqa: F401 — registers models with Base metadata
from routers import router
from services.backup_service import tick_due_backups
from services.cover_cache_service import SIZES, cover_size_dir
from services.share_service import is_share_token

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)
settings = get_settings()


async def _backup_scheduler_loop(interval_seconds: int) -> None:
    """Run ``tick_due_backups`` on a fixed frequency until cancelled.

    Each tick opens a fresh DB session so a long-running connection isn't
    held idle between ticks. Errors are logged but never propagated — the
    loop must keep running for future ticks.
    """
    # Small grace period before the first tick so the rest of startup
    # finishes before we touch the DB.
    await asyncio.sleep(min(30, interval_seconds))
    while True:
        try:
            db = SessionLocal()
            try:
                count = tick_due_backups(db)
                if count:
                    logger.info("Backup scheduler: sent %d backup(s).", count)
            finally:
                db.close()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Backup scheduler tick raised — continuing.")
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables on startup, then start the periodic backup loop."""
    logger.info("Starting up — creating tables if needed…")
    Base.metadata.create_all(bind=engine)
    logger.info("Database ready.")

    scheduler_task: asyncio.Task | None = None
    if settings.smtp_configured:
        logger.info(
            "Starting backup scheduler (every %ds).",
            settings.BACKUP_TICK_SECONDS,
        )
        scheduler_task = asyncio.create_task(
            _backup_scheduler_loop(settings.BACKUP_TICK_SECONDS),
            name="backup-scheduler",
        )
    else:
        logger.info(
            "SMTP not configured — backup scheduler disabled. "
            "See backend/BACKUP.md to enable it."
        )

    try:
        yield
    finally:
        if scheduler_task is not None:
            scheduler_task.cancel()
            try:
                await scheduler_task
            except (asyncio.CancelledError, Exception):
                pass
        logger.info("Shutting down.")


app = FastAPI(
    title="LOGARIUM API",
    description="Backend for the LOG media tracking application.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Share-link guard ──────────────────────────────────────────────────────────
# A share token (see services/share_service.py) is accepted anywhere a bearer
# token is, so a shared profile reuses every read endpoint as-is. Read-only is
# enforced here rather than route by route: one chokepoint covers everything,
# including routes added later.
#
# Registered before CORS so the CORS middleware stays outermost and a rejection
# still comes back with the right headers (a bare 403 would surface in the
# browser as an opaque CORS failure instead).
SHARE_READ_METHODS = {"GET", "HEAD", "OPTIONS"}
# GETs a viewer must not reach even though they are reads: the account email,
# a full library dump, the owner's API keys via search, and the token management
# route itself.
SHARE_BLOCKED_PATHS = ("/backup/status", "/entries/export", "/search", "/share/link")
# Explore itself is readable on a shared profile (it shows the owner's cached
# recommendations), but a reroll is a GET that spends their provider API keys
# and overwrites their cached set, so that one query is refused.
SHARE_TRUTHY = {"1", "true", "yes", "on"}


@app.middleware("http")
async def share_link_guard(request: Request, call_next):
    auth = request.headers.get("authorization") or ""
    scheme, _, token = auth.partition(" ")
    if scheme.lower() == "bearer" and is_share_token(token.strip()):
        path = request.url.path
        if request.method not in SHARE_READ_METHODS:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "This is a read-only shared profile."},
            )
        if any(path == blocked or path.startswith(blocked + "/") for blocked in SHARE_BLOCKED_PATHS):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Not available on a shared profile."},
            )
        if path == "/explore" and request.query_params.get("refresh", "").lower() in SHARE_TRUTHY:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Rerolling is not available on a shared profile."},
            )
    return await call_next(request)


# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    # Browser-extension origins use a random per-install UUID, so they can't be
    # listed explicitly — match the scheme instead. The API is bearer-token only
    # (no cookies), so the regex echoes the specific origin and credentials still work.
    allow_origin_regex=r"^(moz-extension|chrome-extension)://.+$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ImmutableCoverFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


for cover_size in SIZES:
    app.mount(
        f"/covers/{cover_size}",
        ImmutableCoverFiles(directory=cover_size_dir(cover_size), check_dir=False),
        name=f"covers-{cover_size}",
    )

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(router)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
def health():
    return {"status": "ok"}
