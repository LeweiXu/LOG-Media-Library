import csv
import io
from sqlalchemy.orm import Session
from models import Entry

EXPORT_COLUMNS = [
    "title", "medium", "origin", "year", "cover_url", "notes",
    "external_id", "source", "status", "rating", "progress", "total",
    "created_at", "updated_at", "completed_at",
]


def export_entries_csv(db: Session, username: str) -> str:
    entries = (
        db.query(Entry)
        .filter(Entry.username == username)
        .order_by(Entry.id)
        .all()
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(EXPORT_COLUMNS)
    for e in entries:
        writer.writerow([getattr(e, col) for col in EXPORT_COLUMNS])
    return output.getvalue()
