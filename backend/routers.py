from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from db import get_db
from schemas import EntryCreate, EntryListResponse, EntryRead, EntryUpdate, SearchResult, StatsResponse
from services import entry_service
from services.search_service import search_media
from services.stats_service import get_stats

router = APIRouter()

# Entries endpoints
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
):
    return entry_service.get_entries(
        db,
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
def get_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = entry_service.get_entry_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entry

@router.post("/entries", response_model=EntryRead, status_code=status.HTTP_201_CREATED)
def create_entry(payload: EntryCreate, db: Session = Depends(get_db)):
    return entry_service.create_entry(db, payload)

@router.put("/entries/{entry_id}", response_model=EntryRead)
def update_entry(entry_id: int, payload: EntryUpdate, db: Session = Depends(get_db)):
    entry = entry_service.get_entry_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    return entry_service.update_entry(db, entry, payload)

@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = entry_service.get_entry_by_id(db, entry_id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    entry_service.delete_entry(db, entry)

# Search endpoint
from fastapi import Query
@router.get("/search", response_model=list[SearchResult])
async def search(
    title:  str = Query(..., min_length=1, description="Title to search for"),
    medium: str = Query("", description="Optional medium hint"),
):
    return await search_media(title=title, medium=medium)

# Stats endpoint
@router.get("/stats", response_model=StatsResponse)
def stats(db: Session = Depends(get_db)):
    return get_stats(db)
