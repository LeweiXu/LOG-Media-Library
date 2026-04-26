from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from db import engine, Base
from models import Entry, ExploreCache, User  # noqa: F401 — registers models with Base metadata
from routers import router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables on startup if they do not exist (dev convenience)."""
    logger.info("Starting up — creating tables if needed…")
    Base.metadata.create_all(bind=engine)
    logger.info("Database ready.")
    yield
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
