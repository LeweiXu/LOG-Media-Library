from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/mediatracker"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,https://log-media-tracker.vercel.app"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 6443

    # Auth
    SECRET_KEY: str = "changeme-replace-with-a-strong-random-secret"
    JWT_ALGORITHM: str = "HS256"

    # External API keys (all optional)
    TMDB_API_KEY: str = ""
    IGDB_CLIENT_ID: str = ""
    IGDB_CLIENT_SECRET: str = ""
    GOOGLE_BOOKS_API_KEY: str = ""
    RAWG_API_KEY: str = ""
    COMICVINE_API_KEY: str = ""

    # ── Email backup (all optional — feature is disabled if any are missing) ──
    # See backend/BACKUP.md for setup instructions (Gmail app password etc.).
    SMTP_HOST:     str = ""
    SMTP_PORT:     int = 587
    SMTP_USER:     str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM:     str = ""    # falls back to SMTP_USER if blank
    # Frequency the scheduler ticks at — independent of per-user backup_freq.
    BACKUP_TICK_SECONDS: int = 3600

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def smtp_configured(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_USER and self.SMTP_PASSWORD)

    @property
    def smtp_from_address(self) -> str:
        return self.SMTP_FROM or self.SMTP_USER


@lru_cache
def get_settings() -> Settings:
    return Settings()
