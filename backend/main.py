from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import get_settings
from db import SessionLocal, engine, Base
from models import Entry, ExploreCache, User  # noqa: F401 — registers models with Base metadata
from routers import router
from services.backup_service import tick_due_backups
from services.cover_cache_service import SIZES, cover_size_dir

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
