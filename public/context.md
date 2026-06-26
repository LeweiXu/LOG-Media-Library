# LOG — Media Tracker: Project Context

Provide this file to your LLM at the start of each session. For UI work, also
include `frontend/styles.css` and the relevant files under `frontend/styles/`.

---

## 1. What This Project Is

LOG is a full-stack media tracker for films, TV, anime, games, books, manga, light novels, web novels, comics, and visual novels.

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
logarium/
├── README.md
├── CLAUDE.md            # agent guidance (architecture + conventions)
├── AGENTS.md
├── CLOUDFLARE.md
├── context.md           # this file
├── dev.sh               # boots backend + frontend together
├── backend/
│   ├── main.py
│   ├── run.py
│   ├── config.py
│   ├── constants.py
│   ├── db.py
│   ├── models.py
│   ├── schemas.py
│   ├── routers.py        # single thin APIRouter
│   ├── requirements.txt
│   ├── README.md
│   ├── alembic.ini
│   ├── alembic/          # env.py + versions/ (migrations are source of truth)
│   ├── scripts/
│   │   └── init_db.py
│   └── services/
│       ├── auth_service.py
│       ├── entry_service.py
│       ├── stats_service.py
│       ├── search_service.py        # provider fan-out
│       ├── explore_service.py       # recommendations + consumption profile
│       ├── import_service.py        # CSV/JSON preview→confirm + SSE auto-import
│       ├── import_mal_service.py    # MyAnimeList XML import
│       ├── export_service.py
│       ├── url_import_service.py     # add-by-URL (+ url_scrapers/)
│       ├── cover_cache_service.py    # server-side + extension cover caching
│       ├── backup_service.py         # periodic email backups
│       ├── email_service.py
│       └── search_providers/
│           ├── __init__.py           # provider registry
│           ├── utils.py
│           ├── tmdb.py  imdb.py  anilist.py  jikan.py  kitsu.py  mangadex.py
│           ├── mangaupdates.py  novelupdates.py
│           ├── igdb.py  rawg.py  vndb.py
│           └── google_books.py  open_library.py  comicvine.py  goodreads.py
├── frontend/
│   ├── index.html  index.jsx  app.jsx
│   ├── api.jsx           # all network calls (reads VITE_API_BASE)
│   ├── utils.jsx         # status/medium/origin enums + helpers
│   ├── preferences.jsx   # PreferencesProvider + ui_preferences doc (DEFAULT_UI)
│   ├── extensionBridge.js
│   ├── hooks.jsx
│   ├── styles.css        # CSS entrypoint: imports frontend/styles/*.css
│   ├── design.css        # older design reference
│   ├── styles/
│   │   ├── tokens.css              # theme/accent/chart CSS variables
│   │   ├── base.css                # reset, body, links, scrollbars
│   │   ├── shell.css               # app shell, topbar, sidebars, buttons
│   │   ├── components.css          # shared UI: tables, modals, forms, skeletons
│   │   ├── library-dashboard.css   # Library/Dashboard-specific helpers
│   │   ├── statistics-explore.css  # Statistics, Landing, Explore styles
│   │   ├── responsive.css          # mobile/drawer/table responsive rules
│   │   ├── tools-add-custom.css    # Console tools, add/quick-add/import styles
│   │   └── light.css               # light-theme overrides, imported last
│   ├── vite.config.js  vercel.json  package.json
│   └── pages/
│       ├── Dashboard.jsx  Library.jsx  Explore.jsx  Statistics.jsx
│       ├── Console.jsx    # settings + library tools (after Statistics)
│       ├── LandingPage.jsx
│       └── components/
│           ├── AuthModal.jsx
│           ├── AddEntryModal.jsx  AddEntryPanel.jsx  QuickAddModal.jsx
│           ├── EntryForm.jsx  EntryFormModal.jsx  EntryDetailModal.jsx  ConfirmEntryModal.jsx
│           ├── ListChips.jsx  ListsPanel.jsx  ListsModal.jsx  InlineListSelect.jsx  CustomListField.jsx
│           ├── DedupPanel.jsx  CacheCoversPanel.jsx  ResyncPanel.jsx
│           ├── ImportPanel.jsx  ImportAutoPanel.jsx  ImportMalPanel.jsx
│           ├── ExtensionInstallHint.jsx  ExtensionDownloadSection.jsx  ExtensionUpdateLink.jsx
│           ├── CustomSelect.jsx  Skeletons.jsx  terminal.jsx
│           └── searchSources.js   # provider list + available-sources selection
├── extension/           # Manifest V3 browser extension (Chrome + Firefox)
└── public/              # misc scripts / notes (e.g. test_novelupdates.py)
```

> The `*Panel` components are the inline bodies rendered inside Console's
> collapsible tool sections; most were extracted from former modals.

---

## 4. Data Model (Current)

Main tables/models:

### User
- `username` (PK), `email` (unique), `hashed_password`
- Settings: `backup_freq`, `last_backup_at`, and a single `ui_preferences`
  JSON document (see §6). Older scalar preference columns remain for server-side
  consumers; the JSON doc is the client-facing view.

### Entry
- Core: `id`, `title`, `medium`, `origin`, `year`, `status`, `rating`, `progress`, `total`, `notes`
- Metadata: `cover_url`, `external_id`, `source`, `external_url`, `genres`, `external_rating`
- Timestamps: `created_at`, `updated_at`, `completed_at`
- Ownership: `username` (FK to users.username)

### ExploreCache
- Per-`(username, key)` cache of ranked explore results. The `key` packs the
  medium tab plus flags for neutral mode and a hash of the available-source set;
  it is `VARCHAR(50)`, so keep cache keys short.

Canonical sets (validated in backend constants/schemas, mirrored in `frontend/utils.jsx`):
- Status: `current`, `planned`, `completed`, `on_hold`, `dropped`
- Medium: Film, TV Show, Anime, Book, Manga, Light Novel, Web Novel, Comic, Game, Visual Novel
- Origin: Japanese, Korean, Chinese, Western, Other

---

## 5. Backend API Contract (Current)

All routes except health and auth require `Authorization: Bearer <token>`.

### Health
- `GET /` -> `{"status": "ok"}`

### Auth & settings
- `POST /auth/register` -> create account
- `POST /auth/login` -> OAuth2 password form, returns bearer token
- `POST /auth/change-password` -> authenticated password change
- `GET /auth/me/settings` -> `{ backup_freq, ui }` (UI doc deep-merged with defaults)
- `PUT /auth/me/settings` -> partial update; `ui` is deep-merged into the stored doc

### Entries
- `GET /entries` -> list with filters/pagination
  - Query params: `status`, `medium`, `origin`, `title`, `sort`, `order`, `limit`, `offset`
  - Response shape: `{ items, total, limit, offset }`
- `GET /entries/{id}` -> single entry (user-scoped)
- `POST /entries` -> create
- `PUT /entries/{id}` -> partial update (`exclude_unset=True`)
- `DELETE /entries/{id}` -> delete one
- `DELETE /entries` -> delete all entries for current user

### Batch / duplicates
- `PUT /entries/batch` -> bulk field update for a list of ids
- `DELETE /entries/batch` -> bulk delete
- `GET /entries/duplicates` -> groups of entries sharing (title, medium)
- `POST /entries/check-duplicates` -> which of the given title/year/medium triples already exist

### Search
- `GET /search?title=...&source=...` (optionally `sources=a,b,c`)
- `source` optional; omitted -> fan out across providers, deduplicate/rank (capped at 10)
- `GET /search/from-url?url=...` -> add-by-URL: scrape a supported source page to a
  prefilled entry. Usually one result, but some pages resolve to **many** (a
  Goodreads `/series/<id>` URL -> one result per numbered book)
- `GET /search/chapter-count?title=...` -> on-demand MangaUpdates chapter total (ongoing manga)
- `GET /search/imdb-detail?id=tt...` -> on-demand IMDb detail (rating, episode count,
  year, cover, genres); used to enrich an IMDb-sourced Film/TV entry when adding

### Explore (recommendations)
- `GET /explore?medium=&limit=&seed=&refresh=&sources=a,b,c`
- Returns `{ items, affinity, personalised }`. Honours the user's `ui.explore`
  (`by` dimension + `personalize`); `sources` restricts which providers are drawn
  from. Results cached per `(user, medium, personalize, sources-hash)`.

### Custom lists
- `GET /custom-lists` -> `[{ name, count, updated_at }]`
- `PUT /custom-lists/{name}` -> rename; `DELETE /custom-lists/{name}` -> clear

### Covers
- `POST /covers/upload` -> store cover bytes (used by the extension for
  Cloudflare-gated images); cached covers served back from `COVER_CACHE_DIR`
- `GET /covers/cache` -> SSE stream that server-side caches uncached covers

### Stats
- `GET /stats` -> aggregate counts, avg ratings, medium/origin breakdowns,
  per-month activity, completion-by-medium, rating distribution/comparison,
  backlog age, release-year profile, completion streaks

### Import/Export
- `GET /entries/export` -> CSV export for authenticated user
- `POST /entries/import/preview` -> classify uploaded CSV rows (`to_import`, `exact_duplicates`, `conflicts`)
- `POST /entries/import/confirm` -> apply selected creates/updates
- `POST /entries/import/auto` -> SSE stream that auto-searches metadata row-by-row
- `POST /entries/import/mal` -> SSE stream importing a MyAnimeList XML export (+ confirm step for conflicts)

### Backup
- `GET /backup/status` -> `{ configured, backup_freq, last_backup_at, email }`
- `POST /backup/run` -> email a backup now (requires SMTP configured)

> Endpoint paths above are indicative; the live contract is the source of truth —
> see `routers.py` and the interactive docs at `/docs`.

---

## 6. Frontend Behavior (Current)

- React Router routes in `app.jsx`: `/dashboard`, `/library`, `/explore`,
  `/statistics`, `/console`. Legacy redirects: `/manage` -> `/library?mode=manage`,
  `/settings` -> `/console`. Unauthenticated users see `LandingPage` / `AuthModal`.
- Global auth state in localStorage (`auth_token`, `auth_username`).
- Theme is a light/dark class on the root **plus** a user-selectable accent colour
  (`data-accent` on `<html>`); the landing page is always dark/blue.
- Top-level pages:
  - Dashboard: current/recent sections, quick status changes, sidebar filters, activity view
  - Library: full table, sorting/filtering, pagination, inline edits, custom-list
    chips, and a right-sidebar "Multi-select" toggle that swaps Sort for bulk
    batch-edit tools (the former Manage page)
  - Explore: personalised recommendations with a "bias on/off" affinity sidebar
  - Statistics: Recharts visualizations and breakdowns
  - Console: merged settings + library tools — a browser-extension download
    section at the top (shown only when the extension is missing or out of date),
    theme/accent, per-page layout, Explore bias & personalisation, available
    search sources, change password, periodic backup, plus collapsible inline
    tools (custom lists, duplicate finder, cover caching, CSV/auto/MAL import,
    CSV export, data wipe). The "Install Extension" button was removed from other
    pages; the Dashboard shows only an "Update Extension" link (→ Console) when an
    installed copy is out of date.
- **UI preferences** live in a single `ui_preferences` JSON document
  (`frontend/preferences.jsx` `usePreferences`, mirrored by `schemas.DEFAULT_UI`);
  per-page layout reads from it. Don't add parallel localStorage prefs (the
  search-source availability selection in `searchSources.js` is a deliberate
  pre-existing exception).
- **CSS architecture:** `frontend/styles.css` is only the stable import
  entrypoint, used by both the main app and the extension popup. Add rules to the
  purpose-specific files in `frontend/styles/` and preserve import order. Keep
  page-specific selectors in their page files and shared primitives/utilities in
  `components.css`, `shell.css`, or `base.css`.
- **Inline style convention:** static presentation belongs in CSS classes.
  Runtime-calculated values may be passed from JSX only as CSS custom properties
  (examples: progress widths, chart bar heights, dashboard split ratios,
  skeleton sizes, swatch colors). `CustomSelect` is the intentional exception:
  its portaled menu uses measured inline `left/top/width/maxHeight` geometry.

---

## 7. Search Provider Notes

Search is provider-based and asynchronous. Providers currently wired (15):
- IMDb, TMDB, AniList, Jikan, Kitsu
- NovelUpdates, MangaDex, MangaUpdates
- IGDB, RAWG
- Goodreads, Google Books, Open Library, ComicVine
- VNDB

Backend combines provider results, deduplicates similar title/medium pairs, and
ranks by source priority (exact title matches first). See README → "How Each
Source Works" for the per-source access mechanism, keys, and quirks. Highlights:
- **IMDb** (no key, default Film/TV): suggestion API for search, GraphQL for
  detail (real rating + episode count, fetched on add via `/search/imdb-detail`)
  and for Explore. IMDb title pages are AWS-WAF-walled and unused.
- **Goodreads** (no key, default Books): `auto_complete` JSON for search, page
  `__NEXT_DATA__`/`ld+json` scrape for detail + **whole-series add** (a
  `/series/<id>` URL → one entry per numbered book), genre shelves for Explore.
  `/search` is WAF-walled and unused.
- **NovelUpdates** (no key): HTML scrape behind Cloudflare; intermittently
  blocked server-side, so the extension provides a silent first-party fallback.
- Ratings out of 5 (Goodreads, NovelUpdates) are normalised ×2 to 0–10.

**Available sources.** The Add-Entry and Explore source pickers only offer the
sources enabled in Console -> Search Sources (sitewide; localStorage
`available_sources` in `frontend/pages/components/searchSources.js`). The default
`DEFAULT_SOURCES` is roughly one provider per medium — **IMDb (film/TV)**, Jikan
(anime/manga) with MangaUpdates as a manga backup, NovelUpdates (light/web novel),
RAWG (games), VNDB (visual novels), **Goodreads (books)**, ComicVine (comics) —
chosen to avoid duplicate hits across overlapping sources (e.g. AniList vs Jikan).

**Explore recommender.** `explore_service.py` reuses the providers' trending /
popular endpoints per medium, restricted to the available sources, drops owned
titles, and ranks by popularity plus an optional bias toward the user's
consumption profile (off when `ui.explore.personalize` is false). Results are
cached per `(user, medium)`, so leaving a slow scan and returning shows the
finished set. The Explore page also keeps a per-medium client cache so toggling a
source only queries the newly-added source instead of a full reroll; if Goodreads
shelves are blocked, the extension loads them first-party and merges them in.

---

## 8. Conventions That Matter for Edits

- Backend architecture is service-oriented: router handlers delegate to `services/*`.
- Entry ownership checks are enforced in routers for read/update/delete.
- `completed_at` is auto-managed when status changes to/from `completed`.
- Frontend components call API helpers from `frontend/api.jsx` (not ad-hoc fetches in random files).
- Utilities/constants for statuses/medium/origin and list normalization live in `frontend/utils.jsx`.
- Frontend styling uses plain CSS only. Prefer existing classes/utilities and
  CSS variables over inline presentation. Be especially careful around
  `.media-table`, `col-*`, `manage-entry-table`, `action-cell`, and
  `data-mobile-show`; those selectors control desktop/mobile table formatting.

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
- Periodic email backups now have a real scheduler (`backup_service`), gated on
  SMTP being configured.
- Custom-list sharing is intentionally deferred (no backend foundation yet).
- Search/source UX continues to be refined (availability selection and ranking).
- The search-source availability selection is localStorage-only (per-device), not
  synced via the `ui_preferences` document.
