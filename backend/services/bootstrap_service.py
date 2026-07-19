from sqlalchemy.orm import Session

from schemas import DashboardBootstrapResponse
from services import entry_service
from services.stats_service import get_dashboard_stats


def get_dashboard_bootstrap(
    db: Session,
    username: str,
    visible_mediums: set[str] | None,
) -> DashboardBootstrapResponse:
    """Build the complete Dashboard payload in one authenticated request."""
    shared = {
        "db": db,
        "username": username,
        "visible_mediums": visible_mediums,
        "include_total": False,
    }
    return DashboardBootstrapResponse(
        stats=get_dashboard_stats(db, username, visible_mediums),
        current=entry_service.get_entries(
            **shared, status="current", limit=20,
        ),
        completed=entry_service.get_entries(
            **shared, status="completed", limit=20,
            sort="completed_at", order="desc",
        ),
        on_hold=entry_service.get_entries(
            **shared, status="on_hold", limit=6,
            sort="updated_at", order="desc",
        ),
        dropped=entry_service.get_entries(
            **shared, status="dropped", limit=6,
            sort="updated_at", order="desc",
        ),
        planned=entry_service.get_entries(
            **shared, status="planned", limit=20,
            sort="updated_at", order="desc",
        ),
    )
