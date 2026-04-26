import io
import json
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from db import get_db
from models import User
from schemas import (
    EntryCreate, EntryListResponse, EntryRead, EntryUpdate,
    ImportConfirmRequest, ImportConfirmResponse, ImportPreviewResponse,
    SearchResult, StatsResponse,
    UserCreate, UserRead, Token, ChangePassword,
    UserSettings, UserSettingsUpdate,
    DuplicateCheckRequest, DuplicateCheckResponse,
    ExploreResponse,
)
from services import entry_service
from services.entry_service import delete_all_entries
from services import auth_service
from services.search_service import search_media
from services.stats_service import get_stats
from services.export_service import export_entries_csv
from services.import_service import preview_import, confirm_import, auto_import_rows
from services.import_mal_service import import_mal_rows, confirm_mal_import
from services.explore_service import explore_media

router = APIRouter()

# ── Auth routes ───────────────────────────────────────────────────────────────

@router.post("/auth/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    if auth_service.get_user_by_username(db, payload.username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken")
    if auth_service.get_user_by_email(db, payload.email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    print(payload.username, payload.email, payload.password)  # --- DEBUG ---
    user = User(
        username=payload.username,
        email=payload.email,
        hashed_password=auth_service.hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

@router.post("/auth/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = auth_service.get_user_by_username(db, form.username)
    if not user or not auth_service.verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return Token(access_token=auth_service.create_token(user.username))

@router.post("/auth/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePassword,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    if not auth_service.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current_user.hashed_password = auth_service.hash_password(payload.new_password)
    db.commit()

# ── Settings routes ───────────────────────────────────────────────────────────

@router.get("/auth/me/settings", response_model=UserSettings)
def get_settings(
    current_user: User = Depends(auth_service.get_current_user),
):
    return current_user

@router.put("/auth/me/settings", response_model=UserSettings)
def update_settings(
    payload: UserSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user

# ── Entries endpoints ─────────────────────────────────────────────────────────

@router.get("/entries/export")
def export_entries(
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    csv_content = export_entries_csv(db, current_user.username)
    filename = f"library_{current_user.username}.csv"
    return StreamingResponse(
        io.StringIO(csv_content),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.post("/entries/import/preview", response_model=ImportPreviewResponse)
async def import_preview(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    content = await file.read()
    return preview_import(db, content.decode("utf-8-sig"), current_user.username)

@router.post("/entries/import/confirm", response_model=ImportConfirmResponse)
def import_confirm(
    payload: ImportConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    to_update = [{"db_id": item.db_id, "csv_row": item.csv_row} for item in payload.to_update]
    return confirm_import(db, payload.to_create, to_update, current_user.username)

@router.post("/entries/import/auto")
async def import_auto(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    content = (await file.read()).decode("utf-8-sig")

    async def event_stream():
        async for event in auto_import_rows(content, db, current_user.username):
            if await request.is_disconnected():
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/entries/import/mal")
async def import_mal(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    content = (await file.read()).decode("utf-8-sig")

    async def event_stream():
        async for event in import_mal_rows(content, db, current_user.username):
            if await request.is_disconnected():
                break
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/entries/import/mal/confirm")
def import_mal_confirm(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    entries = payload.get("entries", [])
    return confirm_mal_import(db, entries, current_user.username)


@router.get("/entries", response_model=EntryListResponse)
def list_entries(
    status: str = Query(None, description="Filter by status"),
    medium: str = Query(None, description="Filter by medium"),
    origin: str = Query(None, description="Filter by origin"),
    title:  str = Query(None, description="Search by title (case-insensitive)"),
    sort:   str = Query("updated_at", description="Column to sort by"),
    order:  str = Query("desc",       description="asc or desc"),
    limit:  int = Query(40,  ge=1, le=2000, description="Max results to return"),
    offset: int = Query(0,   ge=0,          description="Number of results to skip"),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    return entry_service.get_entries(
        db,
        username=current_user.username,
        status=status,
        medium=medium,
        origin=origin,
        title=title,
        sort=sort,
        order=order,
        limit=limit,
        offset=offset,
    )

@router.get("/entries/{entry_id}", response_model=EntryRead)
def get_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    entry = entry_service.get_entry_by_id(db, entry_id)
    if not entry or entry.username != current_user.username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entry

@router.post("/entries", response_model=EntryRead, status_code=status.HTTP_201_CREATED)
def create_entry(
    payload: EntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    return entry_service.create_entry(db, payload, username=current_user.username)

@router.put("/entries/{entry_id}", response_model=EntryRead)
def update_entry(
    entry_id: int,
    payload: EntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    entry = entry_service.get_entry_by_id(db, entry_id)
    if not entry or entry.username != current_user.username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entry_service.update_entry(db, entry, payload)

@router.post("/entries/check-duplicates", response_model=DuplicateCheckResponse)
def check_duplicates(
    payload: DuplicateCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    exists = entry_service.check_duplicates(db, current_user.username, payload.items)
    return DuplicateCheckResponse(exists=exists)

@router.delete("/entries", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_user_entries(
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    delete_all_entries(db, current_user.username)

@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    entry = entry_service.get_entry_by_id(db, entry_id)
    if not entry or entry.username != current_user.username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    entry_service.delete_entry(db, entry)

# ── Search endpoint ───────────────────────────────────────────────────────────

@router.get("/search", response_model=list[SearchResult])
async def search(
    title:  str = Query(..., min_length=1, description="Title to search for"),
    source: str = Query("", description="Optional source to search (e.g. tmdb, anilist, igdb)"),
    current_user: User = Depends(auth_service.get_current_user),
):
    return await search_media(title=title, source=source)

# ── Explore endpoint ──────────────────────────────────────────────────────────

@router.get("/explore", response_model=ExploreResponse)
async def explore(
    medium:  str  = Query("", description="Optional medium filter"),
    limit:   int  = Query(40, ge=1, le=80),
    seed:    int  = Query(0,  ge=0, description="Shuffle seed; only consulted on a fresh fetch"),
    refresh: bool = Query(False, description="Bypass and overwrite the per-medium cache"),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    return await explore_media(
        db,
        username=current_user.username,
        medium=medium or None,
        explore_by=current_user.explore_by or "all",
        limit=limit,
        seed=seed or None,
        refresh=refresh,
    )

# ── Stats endpoint ────────────────────────────────────────────────────────────

@router.get("/stats", response_model=StatsResponse)
def stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(auth_service.get_current_user),
):
    return get_stats(db, username=current_user.username)
