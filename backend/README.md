# Media Tracker — Backend

FastAPI + PostgreSQL backend for the LOG media tracking application.

## Requirements

- Python 3.11+
- PostgreSQL 14+

---

## Quick Start

### 1. Create and activate a virtual environment

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/mediatracker
CORS_ORIGINS=http://localhost:3000
```

### 4. Create the database

```bash
# In psql or your PostgreSQL client:
CREATE DATABASE mediatracker;
```

### 5. Run migrations

```bash
alembic upgrade head
```

Or use the convenience script (also works for initial setup):

```bash
python scripts/init_db.py          # create tables only
python scripts/init_db.py --seed   # create tables + insert sample data
```

### 6. Start the server

```bash
python main.py
```

The API will be available at `http://0.0.0.0:6443`.  
Interactive docs: `http://localhost:6443/docs`

---

## Project Structure

```
backend/
├── main.py                   Entry point — runs uvicorn
├── requirements.txt
├── .env.example              Environment variable template
├── alembic.ini               Alembic configuration
├── alembic/
│   ├── env.py                Reads DATABASE_URL from .env
│   └── versions/
│       └── 0001_*.py         Initial schema migration
├── app/
│   ├── main.py               FastAPI app, CORS, router registration
│   ├── config.py             Centralised settings (pydantic-settings)
│   ├── db/
│   │   └── session.py        SQLAlchemy engine, SessionLocal, get_db
│   ├── models/
│   │   └── entry.py          ORM model — entries table
│   ├── schemas/
│   │   ├── entry.py          EntryCreate / EntryUpdate / EntryRead
│   │   ├── search.py         SearchResult
│   │   └── stats.py          StatsResponse
│   ├── services/
│   │   ├── entry_service.py  CRUD + filter / sort / paginate
│   │   ├── stats_service.py  SQL aggregations for /stats
│   │   └── search_service.py Fan-out to TMDB, AniList, IGDB, Google Books
│   └── routers/
│       ├── entries.py        GET/POST/PUT/DELETE /entries
│       ├── search.py         GET /search
│       └── stats.py          GET /stats
└── scripts/
    └── init_db.py            DB initialisation + optional seed data
```

---

## API Reference

### Health

| Method | Path | Description        |
|--------|------|--------------------|
| GET    | `/`  | Health check → `{"status":"ok"}` |

### Entries — `GET /entries`

Query parameters:

| Param    | Type   | Default      | Description                              |
|----------|--------|--------------|------------------------------------------|
| `status` | string | —            | Filter: `current` `planned` `completed` `on_hold` `dropped` |
| `medium` | string | —            | Filter: `Film` `TV Show` `Anime` etc.    |
| `origin` | string | —            | Filter: `Japanese` `Korean` `Western` etc. |
| `title`  | string | —            | Case-insensitive title search            |
| `sort`   | string | `updated_at` | Column to sort by                        |
| `order`  | string | `desc`       | `asc` or `desc`                          |
| `limit`  | int    | `40`         | Max results (1–2000)                     |
| `offset` | int    | `0`          | Pagination offset                        |

Response:

```json
{
  "items": [ { ...entry } ],
  "total": 296,
  "limit": 40,
  "offset": 0
}
```

### Entries — other methods

| Method | Path               | Body          | Description        |
|--------|--------------------|---------------|--------------------|
| GET    | `/entries/{id}`    | —             | Get single entry   |
| POST   | `/entries`         | EntryCreate   | Create entry       |
| PUT    | `/entries/{id}`    | EntryUpdate   | Update entry       |
| DELETE | `/entries/{id}`    | —             | Delete entry       |

**Entry fields:**

| Field        | Type    | Required | Notes                             |
|--------------|---------|----------|-----------------------------------|
| `title`      | string  | Yes      | 1–500 chars                       |
| `medium`     | string  | No       | `Film` `TV Show` `Anime` `Book` `Manga` `Light Novel` `Web Novel` `Comic` `Game` |
| `origin`     | string  | No       | `Japanese` `Korean` `Chinese` `Western` `Other` |
| `year`       | int     | No       | 1800–2100                         |
| `status`     | string  | No       | Default `planned`                 |
| `rating`     | float   | No       | 0–10                              |
| `progress`   | int     | No       | Current episode / page            |
| `total`      | int     | No       | Total episodes / pages            |
| `cover_url`  | string  | No       | URL to cover image                |
| `notes`      | string  | No       | Free-text notes                   |
| `external_id`| string  | No       | ID from the source API            |
| `source`     | string  | No       | `tmdb` `anilist` `igdb` `google_books` |

### Search — `GET /search`

| Param    | Type   | Required | Description                   |
|----------|--------|----------|-------------------------------|
| `title`  | string | Yes      | Title to search for           |
| `medium` | string | No       | Medium hint to narrow results |

Returns an array of up to 10 `SearchResult` objects.

Providers queried (requires API keys in `.env`):

| Provider     | Covers          | Key(s) needed                            |
|--------------|-----------------|------------------------------------------|
| TMDB         | Film, TV Show   | `TMDB_API_KEY`                           |
| AniList      | Anime, Manga    | None — free GraphQL API                  |
| IGDB         | Game            | `IGDB_CLIENT_ID` + `IGDB_CLIENT_SECRET`  |
| Google Books | Book            | `GOOGLE_BOOKS_API_KEY` (optional)        |

If a provider has no key configured it is silently skipped — the other providers still run.

### Stats — `GET /stats`

Returns aggregated counts, average rating, breakdowns by medium/origin, and entries per month.

---

## Migrations

Create a new migration after changing models:

```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

Roll back one step:

```bash
alembic downgrade -1
```

---

## Running in Production

```bash
uvicorn app.main:app --host 0.0.0.0 --port 6443 --workers 4
```

For a systemd service, proxy via nginx, or deploy inside Docker — the app exposes no state beyond the PostgreSQL connection defined in `DATABASE_URL`.
