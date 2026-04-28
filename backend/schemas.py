# --- Entry Schemas ---
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator

from constants import (
    VALID_STATUSES, VALID_MEDIUMS, VALID_ORIGINS,
    normalise_medium, normalise_origin,
)


class EntryBase(BaseModel):
    title:       str             = Field(..., min_length=1, max_length=500)
    medium:      Optional[str]   = Field(None, max_length=100)
    origin:      Optional[str]   = Field(None, max_length=100)
    year:        Optional[int]   = Field(None, ge=1800, le=2100)
    cover_url:   Optional[str]   = Field(None, max_length=1000)
    notes:       Optional[str]   = None
    status:      str             = Field("planned", max_length=50)
    rating:      Optional[float] = Field(None, ge=0, le=10)
    progress:    Optional[int]   = Field(None, ge=0)
    total:       Optional[int]   = Field(None, ge=0)
    external_id:     Optional[str]   = Field(None, max_length=200)
    source:          Optional[str]   = Field(None, max_length=100)
    external_url:    Optional[str]   = Field(None, max_length=1000)
    genres:          Optional[str]   = Field(None, max_length=500)
    external_rating: Optional[float] = Field(None, ge=0, le=100)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(VALID_STATUSES)}")
        return v

    @field_validator("medium")
    @classmethod
    def validate_medium(cls, v: str | None) -> str | None:
        if v is None:
            return v
        normalised = normalise_medium(v)
        if normalised not in VALID_MEDIUMS:
            raise ValueError(f"medium must be one of {sorted(VALID_MEDIUMS)}")
        return normalised

    @field_validator("origin")
    @classmethod
    def validate_origin(cls, v: str | None) -> str | None:
        if v is None:
            return v
        normalised = normalise_origin(v)
        if normalised not in VALID_ORIGINS:
            raise ValueError(f"origin must be one of {sorted(VALID_ORIGINS)}")
        return normalised


class EntryCreate(EntryBase):
    completed_at: Optional[datetime] = None

class EntryUpdate(BaseModel):
    title:        Optional[str]      = Field(None, min_length=1, max_length=500)
    medium:       Optional[str]      = Field(None, max_length=100)
    origin:       Optional[str]      = Field(None, max_length=100)
    year:         Optional[int]      = Field(None, ge=1800, le=2100)
    cover_url:    Optional[str]      = Field(None, max_length=1000)
    notes:        Optional[str]      = None
    status:       Optional[str]      = Field(None, max_length=50)
    rating:       Optional[float]    = Field(None, ge=0, le=10)
    progress:     Optional[int]      = Field(None, ge=0)
    total:        Optional[int]      = Field(None, ge=0)
    external_id:     Optional[str]      = Field(None, max_length=200)
    source:          Optional[str]      = Field(None, max_length=100)
    external_url:    Optional[str]      = Field(None, max_length=1000)
    genres:          Optional[str]      = Field(None, max_length=500)
    external_rating: Optional[float]    = Field(None, ge=0, le=100)
    completed_at:    Optional[datetime] = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(VALID_STATUSES)}")
        return v

    @field_validator("medium")
    @classmethod
    def validate_medium(cls, v: str | None) -> str | None:
        if v is None:
            return v
        normalised = normalise_medium(v)
        if normalised not in VALID_MEDIUMS:
            raise ValueError(f"medium must be one of {sorted(VALID_MEDIUMS)}")
        return normalised

    @field_validator("origin")
    @classmethod
    def validate_origin(cls, v: str | None) -> str | None:
        if v is None:
            return v
        normalised = normalise_origin(v)
        if normalised not in VALID_ORIGINS:
            raise ValueError(f"origin must be one of {sorted(VALID_ORIGINS)}")
        return normalised

class EntryRead(EntryBase):
    id:           int
    username:     str
    created_at:   datetime
    updated_at:   datetime
    completed_at: Optional[datetime] = None
    model_config = {"from_attributes": True}

class EntryListResponse(BaseModel):
    items: list[EntryRead]
    total: int
    limit: int
    offset: int

# --- User Schemas ---

class UserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    email:    str = Field(..., max_length=320)
    password: str = Field(..., min_length=6)

class UserRead(BaseModel):
    username: str
    email:    str
    model_config = {"from_attributes": True}

class Token(BaseModel):
    access_token: str
    token_type:   str = "bearer"

class ChangePassword(BaseModel):
    current_password: str
    new_password:     str = Field(..., min_length=6)

# --- User Settings ---

_VALID_BACKUP_FREQ = {"never", "daily", "weekly", "monthly"}
# Mirrors entry_service.SORTABLE_COLUMNS keys.
_VALID_DEFAULT_SORT = {
    "title", "medium", "origin", "year", "status", "rating",
    "created_at", "updated_at", "completed_at",
}
_VALID_EXPLORE_BY = {"all", "genre", "medium", "origin"}

class UserSettings(BaseModel):
    """Read & write shape for /auth/me/settings."""
    backup_freq:              str = "never"
    default_sort:             str = "updated_at"
    default_entries_per_page: int = Field(40, ge=10, le=200)
    explore_default_medium:   Optional[str] = None
    explore_personalize:      bool = True
    explore_hide_in_library:  bool = True
    explore_by:               str  = "all"
    model_config = {"from_attributes": True}

    @field_validator("backup_freq")
    @classmethod
    def _v_backup(cls, v: str) -> str:
        if v not in _VALID_BACKUP_FREQ:
            raise ValueError(f"backup_freq must be one of {sorted(_VALID_BACKUP_FREQ)}")
        return v

    @field_validator("default_sort")
    @classmethod
    def _v_sort(cls, v: str) -> str:
        if v not in _VALID_DEFAULT_SORT:
            raise ValueError(f"default_sort must be one of {sorted(_VALID_DEFAULT_SORT)}")
        return v

    @field_validator("explore_default_medium")
    @classmethod
    def _v_explore_medium(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        normalised = normalise_medium(v)
        if normalised not in VALID_MEDIUMS:
            raise ValueError(f"medium must be one of {sorted(VALID_MEDIUMS)}")
        return normalised

    @field_validator("explore_by")
    @classmethod
    def _v_explore_by(cls, v: str) -> str:
        if v not in _VALID_EXPLORE_BY:
            raise ValueError(f"explore_by must be one of {sorted(_VALID_EXPLORE_BY)}")
        return v

class UserSettingsUpdate(BaseModel):
    """Partial update — every field optional."""
    backup_freq:              Optional[str]  = None
    default_sort:             Optional[str]  = None
    default_entries_per_page: Optional[int]  = Field(None, ge=10, le=200)
    explore_default_medium:   Optional[str]  = None
    explore_personalize:      Optional[bool] = None
    explore_hide_in_library:  Optional[bool] = None
    explore_by:               Optional[str]  = None

    @field_validator("backup_freq")
    @classmethod
    def _v_backup(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_BACKUP_FREQ:
            raise ValueError(f"backup_freq must be one of {sorted(_VALID_BACKUP_FREQ)}")
        return v

    @field_validator("default_sort")
    @classmethod
    def _v_sort(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_DEFAULT_SORT:
            raise ValueError(f"default_sort must be one of {sorted(_VALID_DEFAULT_SORT)}")
        return v

    @field_validator("explore_default_medium")
    @classmethod
    def _v_explore_medium(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        normalised = normalise_medium(v)
        if normalised not in VALID_MEDIUMS:
            raise ValueError(f"medium must be one of {sorted(VALID_MEDIUMS)}")
        return normalised

    @field_validator("explore_by")
    @classmethod
    def _v_explore_by(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_EXPLORE_BY:
            raise ValueError(f"explore_by must be one of {sorted(_VALID_EXPLORE_BY)}")
        return v

# --- Backup Schemas ---

class BackupStatus(BaseModel):
    """Reported by GET /backup/status — drives the Settings UI gating."""
    # True iff SMTP_HOST/USER/PASSWORD are all set on the server.
    configured:     bool
    backup_freq:    str
    last_backup_at: Optional[datetime] = None
    # The address backups will be sent to (the user's account email).
    email:          str

# --- Search Schemas ---
from pydantic import BaseModel
class SearchResult(BaseModel):
    title:           str
    medium:          Optional[str]   = None
    origin:          Optional[str]   = None
    year:            Optional[int]   = None
    cover_url:       Optional[str]   = None
    total:           Optional[int]   = None
    external_id:     Optional[str]   = None
    source:          str             = ""
    description:     Optional[str]   = None
    external_url:    Optional[str]   = None
    genres:          Optional[str]   = None
    external_rating: Optional[float] = None

# --- Import Schemas ---
from typing import Any

class ImportPreviewResponse(BaseModel):
    error: Optional[str] = None
    to_import: list[dict[str, Any]] = []
    exact_duplicates: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []

class ImportUpdateItem(BaseModel):
    db_id: int
    csv_row: dict[str, Any]

class ImportConfirmRequest(BaseModel):
    to_create: list[dict[str, Any]] = []
    to_update: list[ImportUpdateItem] = []

class ImportConfirmResponse(BaseModel):
    created: int
    updated: int
    skipped: int

# --- Duplicate Check Schemas ---
class DuplicateCheckItem(BaseModel):
    title:  str
    year:   Optional[int] = None
    medium: Optional[str] = None

class DuplicateCheckRequest(BaseModel):
    items: list[DuplicateCheckItem]

class DuplicateCheckResponse(BaseModel):
    exists: list[bool]

# --- Explore Schemas ---

class ExploreItem(BaseModel):
    """A single explore result — a SearchResult plus personalisation metadata."""
    title:           str
    medium:          Optional[str]   = None
    origin:          Optional[str]   = None
    year:            Optional[int]   = None
    cover_url:       Optional[str]   = None
    total:           Optional[int]   = None
    external_id:     Optional[str]   = None
    source:          str             = ""
    description:     Optional[str]   = None
    external_url:    Optional[str]   = None
    genres:          Optional[str]   = None
    external_rating: Optional[float] = None
    # Personalisation
    in_library:      bool            = False
    bias_matched:    bool            = False
    # Mixed list of overlaps with the user's most-consumed genres / origins /
    # mediums. Empty when no overlap. Used by the UI for the "matches: …" hint.
    matches:         list[str]       = []

class AffinitySnapshot(BaseModel):
    """Compact summary of what the explore engine learned from the user."""
    sample_size:     int = 0          # number of rated entries used
    top_genres:      list[str] = []   # ranked, up to 5
    top_origins:     list[str] = []   # ranked, up to 3
    top_mediums:     list[str] = []   # ranked, up to 3

class ExploreResponse(BaseModel):
    items:    list[ExploreItem]
    affinity: AffinitySnapshot
    # 'true' iff personalisation was applied to ranking
    personalised: bool

# --- Stats Schemas ---
class MediumCount(BaseModel):
    medium: str
    count:  int
class OriginCount(BaseModel):
    origin: str
    count:  int
class MonthCount(BaseModel):
    key:   str
    label: str
    count: int
class StatsResponse(BaseModel):
    total:     int
    current:   int
    planned:   int
    completed: int
    on_hold:   int
    dropped:   int
    avg_rating: Optional[float] = None
    by_medium: list[MediumCount]
    by_origin: list[OriginCount]
    entries_per_month: list[MonthCount]
