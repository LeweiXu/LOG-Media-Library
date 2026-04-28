from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from db import SessionLocal, engine, Base
from models import Entry, ExploreCache, User  # noqa: F401 — registers models with Base metadata
from routers import router
from services.backup_service import tick_due_backups

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
    title="Media Tracker API",
    description="Backend for the LOG media tracking application.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(router)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/", tags=["health"])
def health():
    return {"status": "ok"}
