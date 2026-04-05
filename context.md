# LOG — Media Tracker: Project Context

> Provide this file (and `design-system.css`) to your LLM at the start of every session.

---

## 1. What This Project Is

A personal web application for tracking all media consumed across every medium: films, TV shows, anime, games, books, manga, light novels, web novels, and comics. Think of it as a personal Letterboxd + MyAnimeList + Goodreads + Backloggd in one place.

The app is called **LOG**. It is a single-user tool running on a home server.

---

## 2. Tech Stack

| Layer     | Technology                                      |
|-----------|-------------------------------------------------|
| Frontend  | React 18, Vite, plain CSS (no Tailwind, no CSS-in-JS) |
| Backend   | Python 3.11+, FastAPI                           |
| Database  | PostgreSQL 14+, SQLAlchemy 2 ORM, Alembic migrations |
| Charts    | Recharts                                        |
| HTTP      | httpx (backend outbound), native fetch (frontend) |

The frontend runs on port **3000** (`npm start` via Vite).  
The backend runs on port **6443** (`python main.py` via uvicorn).

---

## 3. Repository Structure

```
project/
├── frontend/                  # React + Vite application
│   ├── index.html
│   ├── index.jsx
│   ├── app.jsx
│   ├── styles.css
│   ├── api.jsx
│   ├── utils.jsx
│   ├── design.css
│   ├── vite.config.js
│   ├── package.json
│   ├── package-lock.json
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Library.jsx
│   │   ├── Statistics.jsx
│   │   └── components/
│   │       ├── AddEntryModal.jsx
│   │       └── EditEntryModal.jsx
│   └── node_modules/
│
└── backend/                   # FastAPI application
  ├── main.py                # Entry point (runs uvicorn)
  ├── run.py                 # (if present, alternate entry point)
  ├── requirements.txt
  ├── .env
  ├── README.md
  ├── alembic.ini
  ├── alembic/
  │   ├── env.py
  │   ├── README
  │   ├── script.py.mako
  │   └── versions/
  │       └── 0001_create_entries_table.py
  ├── config.py
  ├── db.py
  ├── models.py
  ├── routers.py
  ├── schemas.py
  ├── services/
  │   ├── __init__.py
  │   ├── entry_service.py
  │   ├── search_service.py
  │   └── stats_service.py
  └── scripts/
    ├── __init__.py
    └── init_db.py
```

---

## 4. Data Model

Every tracked item is an **Entry**. There is a single `entries` table.

| Field        | Type    | Notes                                                  |
|--------------|---------|--------------------------------------------------------|
| `id`         | int     | Primary key, auto-increment                            |
| `title`      | string  | Required. 1–500 chars                                  |
| `medium`     | string  | `Film` `TV Show` `Anime` `Book` `Manga` `Light Novel` `Web Novel` `Comics` `Game` |
| `origin`     | string  | `Japanese` `Korean` `Chinese` `Western` `Other`        |
| `year`       | int     | Release year                                           |
| `status`     | string  | `current` `planned` `completed` `on_hold` `dropped`    |
| `rating`     | float   | 0–10                                                   |
| `progress`   | int     | Current episode or page number                         |
| `total`      | int     | Total episodes or pages                                |
| `cover_url`  | string  | URL to cover image                                     |
| `notes`      | text    | Free-text user notes                                   |
| `external_id`| string  | ID from external API (TMDB, AniList, etc.)             |
| `source`     | string  | Which API the metadata came from                       |
| `created_at` | datetime| Auto-set on insert                                     |
| `updated_at` | datetime| Auto-updated on every change                           |
| `completed_at`| datetime| Auto-set when status changes to `completed`           |

---

## 5. API Contract

The frontend in `api.jsx` makes these calls. The backend must match exactly.

### `GET /`
Health check. Returns `{"status": "ok"}`.

### `GET /entries`
Query params: `status`, `medium`, `origin`, `title` (search), `sort`, `order`, `limit`, `offset`.  
Response:
```json
{
  "items": [ { ...EntryRead } ],
  "total": 296,
  "limit": 40,
  "offset": 0
}
```

### `GET /entries/{id}`
Returns a single `EntryRead` object or 404.

### `POST /entries`
Body: `EntryCreate`. Returns `EntryRead` with HTTP 201.

### `PUT /entries/{id}`
Body: `EntryUpdate` (all fields optional). Returns updated `EntryRead`.

### `DELETE /entries/{id}`
Returns HTTP 204 No Content.

### `GET /search?title=&medium=`
Fan-out search across TMDB / AniList / IGDB / Google Books.  
Returns `list[SearchResult]` (max 10 items).  
```json
[{
  "title": "Frieren",
  "medium": "Anime",
  "origin": "Japanese",
  "year": 2023,
  "cover_url": "https://...",
  "total": 28,
  "external_id": "154587",
  "source": "anilist"
}]
```

### `GET /stats`
Returns aggregated library statistics:
```json
{
  "total": 296,
  "current": 4,
  "planned": 23,
  "completed": 251,
  "on_hold": 12,
  "dropped": 6,
  "avg_rating": 8.24,
  "by_medium": [{"medium": "Film", "count": 142}, ...],
  "by_origin": [{"origin": "Japanese", "count": 98}, ...],
  "entries_per_month": [{"key": "2025-01", "label": "Jan 25", "count": 12}, ...]
}
```

---

## 6. Pages

### Dashboard (`Dashboard.jsx`)
- **Left sidebar** — clickable status counts and medium/origin breakdowns (from `/stats`). Clicking navigates to Library with that filter pre-applied.
- **Main** — "Currently Consuming" table (status=current), "Recently Completed" table (status=completed, sorted by updated_at desc). Inline status `<select>` on each row calls `PUT /entries/{id}`. "+ Add Entry" button opens `AddEntryModal`.
- **Right sidebar** — 4 stat boxes (total, avg rating, active, planned), mini bar chart of entries per month, activity log derived from recent entries.

### Library (`Library.jsx`)
- **Left sidebar** — filterable by status, medium, origin. Shows counts. Active filter is highlighted.
- **Main** — full sortable table of all entries. Filter bar at top (title search, sort field, asc/desc toggle, clear button). Inline status `<select>` on every row. Pagination (40 per page). "+ Add Entry" button.
- **Right sidebar** — sort shortcuts, CSV export (current filtered view), count of shown entries.

### Statistics (`Statistics.jsx`)
- Full-width scrollable layout (no three-column).
- 4 summary stat cards (total, completed, avg rating, media types count).
- Bar chart: entries added per month (last 12 months).
- Two-column: horizontal bar chart by medium + rating distribution (1–10).
- Two-column: status pie chart + origin pie chart, each with legend.
- Top-rated table (completed entries, sorted by rating desc).
- Bar chart: entries by release year.
- All charts use **Recharts** and are themed to match the CSS variables.

### Settings (not yet built)
- Dark/light mode toggle.
- Export full library as JSON or CSV.
- Import from JSON.

---

## 7. Components

### `AddEntryModal.jsx`
Two tabs:
1. **Auto Search** — calls `GET /search?title=&medium=`. Shows results list. Clicking a result pre-fills the manual form.
2. **Manual Entry** — form with all entry fields. Submits to `POST /entries`.

### `EditEntryModal.jsx`
- Form pre-filled with all current entry values.
- Submits to `PUT /entries/{id}`.
- Delete button with two-step confirmation → `DELETE /entries/{id}`.

---

## 8. Frontend Conventions

- **No routing library** — page state is held in `app.jsx` as a string (`'dashboard'`, `'library'`, `'statistics'`). Navigation is just `setPage(...)`.
- **All API calls** live in `api.jsx`. No component fetches directly via `fetch`.
- **All helper functions** (formatters, constants) live in `utils.jsx`.
- **CSS only** — no Tailwind, no styled-components, no CSS modules. All classes are in `styles.css`.
- **`.jsx` extension** on every file, including utility files.
- **`extractItems(data)`** — utility function that normalises the varied list response shapes the backend might return (`data`, `data.items`, `data.entries`, etc.).
- Error states display inside `.state-block` divs. Loading states use `.loading-dots` (CSS animated).
- Cover images use `onError` to hide broken images gracefully.

---

## 9. Backend Conventions

- **Services are pure functions** — routers only validate input, call a service, and return. No business logic in routers.
- **`get_db`** is a FastAPI dependency injected into every router function that needs DB access.
- **`EntryUpdate` uses `exclude_unset=True`** when dumping — only fields explicitly sent by the client are written to the DB.
- **`completed_at`** is automatically stamped when `status` changes to `completed`, and cleared when it changes away.
- **`updated_at`** is always stamped on every `PUT`.
- **CORS** is configured via `CORS_ORIGINS` in `.env` — a comma-separated list of allowed origins.
- The search service uses `asyncio.gather` to fan out to all providers simultaneously. Any provider that fails is silently skipped.

---

## 10. Environment Variables

```env
# backend/.env
DATABASE_URL=postgresql://user:password@localhost:5432/mediatracker
CORS_ORIGINS=http://localhost:3000
HOST=0.0.0.0
PORT=6443

# External search API keys (all optional)
TMDB_API_KEY=
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
GOOGLE_BOOKS_API_KEY=
```

---

## 11. What Still Needs Building

The following features are specified but not yet implemented:

- **Settings page** — dark/light mode toggle, JSON/CSV import, full JSON export.
- **Import** — parse a JSON or CSV file and bulk-insert entries via `POST /entries`.
- **Export** — the Library page has a "Export CSV (this view)" button wired up client-side. A full library export (all entries, JSON or CSV) should be a backend endpoint `GET /entries/export`.
- **Auto-search polish** — the search service routes to providers based on medium. Improve result ranking (prefer exact title matches). Add a local duplicate check before inserting.
- **Pagination UX** — the Library shows page X of Y but has no "jump to page" input.
- **Statistics enhancements** — average time to complete, streaks, heat-map calendar of activity.
- **Cover image proxy** — some cover URLs (especially IGDB) may be blocked by CORS. A simple backend proxy endpoint `GET /proxy/image?url=` would fix this.