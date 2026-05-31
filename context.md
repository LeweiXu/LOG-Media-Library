# LOG — Media Tracker: Project Context

Provide this file (and `frontend/design.css`) to your LLM at the start of each session.

---

## 1. What This Project Is

LOG is a full-stack media tracker for films, TV, anime, games, books, manga, light novels, web novels, and comics.

Current state:
- Multi-user app (register/login with JWT bearer auth)
- Public frontend deployment on Vercel
- FastAPI + PostgreSQL backend
- Per-user libraries (all entry queries are scoped by authenticated username)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, plain CSS |
| Backend | Python 3.11+, FastAPI |
| Database | PostgreSQL + SQLAlchemy 2 ORM + Alembic |
| Charts | Recharts |
| HTTP | Browser `fetch`, backend `httpx` |
| Auth | JWT (`python-jose`), password hashing (`passlib` bcrypt_sha256) |

Default local ports:
- Frontend: `3000`
- Backend: `6443`

---

## 3. Current Repository Structure

```text
MediaTrack2.0/
├── README.md
├── context.md
├── cheatsheet.md
├── test_novelupdates.py
├── backend/
│   ├── main.py
│   ├── run.py
│   ├── config.py
│   ├── constants.py
│   ├── db.py
│   ├── models.py
│   ├── schemas.py
│   ├── routers.py
│   ├── requirements.txt
│   ├── demo_script.py
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   ├── README
│   │   └── versions/
│   │       ├── 0001_create_entries_table.py
│   │       └── ee363967b4c6_add_user_table_and_username_fk_to_entry.py
│   ├── scripts/
│   │   ├── __init__.py
│   │   └── init_db.py
│   └── services/
│       ├── __init__.py
│       ├── auth_service.py
│       ├── entry_service.py
│       ├── stats_service.py
│       ├── search_service.py
│       ├── import_service.py
│       ├── export_service.py
│       └── search_providers/
│           ├── __init__.py
│           ├── utils.py
│           ├── tmdb.py
│           ├── anilist.py
│           ├── jikan.py
│           ├── kitsu.py
│           ├── mangadex.py
│           ├── mangaupdates.py
│           ├── novelupdates.py
│           ├── igdb.py
│           ├── rawg.py
│           ├── google_books.py
│           ├── open_library.py
│           └── comicvine.py
└── frontend/
    ├── index.html
    ├── index.jsx
    ├── app.jsx
    ├── api.jsx
    ├── utils.jsx
    ├── styles.css
    ├── design.css
    ├── vite.config.js
    ├── vercel.json
    ├── package.json
    ├── package-lock.json
    └── pages/
        ├── Dashboard.jsx
        ├── Library.jsx
        ├── Statistics.jsx
        └── components/
            ├── AuthModal.jsx
            ├── AddEntryModal.jsx
            ├── EditEntryModal.jsx
            ├── EntryDetailModal.jsx
            ├── ImportModal.jsx
            ├── ImportAutoModal.jsx
            └── SettingsModal.jsx
```

---

## 4. Data Model (Current)

Two main tables/models:

### User
- `username` (PK)
- `email` (unique)
- `hashed_password`

### Entry
- Core: `id`, `title`, `medium`, `origin`, `year`, `status`, `rating`, `progress`, `total`, `notes`
- Metadata: `cover_url`, `external_id`, `source`, `external_url`, `genres`, `external_rating`
- Timestamps: `created_at`, `updated_at`, `completed_at`
- Ownership: `username` (FK to users.username)

Canonical sets (validated in backend constants/schemas):
- Status: `current`, `planned`, `completed`, `on_hold`, `dropped`
- Medium: Film, TV Show, Anime, Book, Manga, Light Novel, Web Novel, Comics, Game
- Origin: Japanese, Korean, Chinese, Western, Other

---

## 5. Backend API Contract (Current)

All routes except health and auth require `Authorization: Bearer <token>`.

### Health
- `GET /` -> `{"status": "ok"}`

### Auth
- `POST /auth/register` -> create account
- `POST /auth/login` -> OAuth2 password form, returns bearer token
- `POST /auth/change-password` -> authenticated password change

### Entries
- `GET /entries` -> list with filters/pagination
  - Query params: `status`, `medium`, `origin`, `title`, `sort`, `order`, `limit`, `offset`
  - Response shape: `{ items, total, limit, offset }`
- `GET /entries/{id}` -> single entry (user-scoped)
- `POST /entries` -> create
- `PUT /entries/{id}` -> partial update (`exclude_unset=True`)
- `DELETE /entries/{id}` -> delete one
- `DELETE /entries` -> delete all entries for current user

### Search
- `GET /search?title=...&source=...`
- `source` is optional; if omitted, backend fans out across providers and deduplicates/ranks
- Result: `list[SearchResult]` (capped at 10)

### Stats
- `GET /stats` -> aggregate counts, avg rating, medium/origin breakdowns, entries per month

### Import/Export
- `GET /entries/export` -> CSV export for authenticated user
- `POST /entries/import/preview` -> classify uploaded CSV rows (`to_import`, `exact_duplicates`, `conflicts`)
- `POST /entries/import/confirm` -> apply selected creates/updates
- `POST /entries/import/auto` -> SSE stream that auto-searches metadata row-by-row

---

## 6. Frontend Behavior (Current)

- Uses React Router routes (`/dashboard`, `/library`, `/statistics`) in `app.jsx`.
- Global auth state in localStorage (`auth_token`, `auth_username`); unauthenticated users see `AuthModal`.
- Theme toggle (light/dark class on root) is implemented.
- Top-level pages:
  - Dashboard: current/recent sections, quick status changes, sidebar filters, activity view
  - Library: full table, sorting/filtering, pagination, inline progress edit, entry detail/edit, import/export
  - Statistics: Recharts visualizations and top-rated breakdowns
- Settings modal includes:
  - Change password
  - Wipe all user entries
  - Placeholder UI for periodic backup schedule

---

## 7. Search Provider Notes

Search is provider-based and asynchronous. Providers currently wired include:
- TMDB, AniList, Jikan, Kitsu
- NovelUpdates, MangaDex, MangaUpdates (module exists)
- IGDB, RAWG
- Google Books, Open Library, ComicVine

Backend combines provider results, deduplicates similar title/medium pairs, and ranks by source priority (exact title matches first).

---

## 8. Conventions That Matter for Edits

- Backend architecture is service-oriented: router handlers delegate to `services/*`.
- Entry ownership checks are enforced in routers for read/update/delete.
- `completed_at` is auto-managed when status changes to/from `completed`.
- Frontend components call API helpers from `frontend/api.jsx` (not ad-hoc fetches in random files).
- Utilities/constants for statuses/medium/origin and list normalization live in `frontend/utils.jsx`.

---

## 9. Environment Variables

Primary backend env vars:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/mediatracker
CORS_ORIGINS=http://localhost:3000,https://logarium.vercel.app
HOST=0.0.0.0
PORT=6443

SECRET_KEY=replace-with-strong-secret
JWT_ALGORITHM=HS256

TMDB_API_KEY=
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
GOOGLE_BOOKS_API_KEY=
RAWG_API_KEY=
COMICVINE_API_KEY=
```

Frontend expects:

```env
VITE_API_BASE=http://localhost:6443
```

---

## 10. Known Gaps / Near-Term TODOs

Items still partially implemented or planned:
- Backup frequency in Settings is UI-only (no scheduler backend yet).
- Search/source UX can still be refined (provider selection and ranking behavior are improving but not final).
- Some README notes and migration docs lag behind current flat backend layout.
