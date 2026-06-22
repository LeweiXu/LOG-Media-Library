# LOGARIUM: Media Tracker

**LOG** is a full-stack web application for tracking every kind of media you
consume (**films, TV shows, anime, games, books, manga, light novels, web
novels, comics, and visual novels**) in a single, unified library.

Most tracking sites are siloed: Letterboxd for film, MyAnimeList for anime,
Goodreads for books, Backloggd for games. If your media diet crosses all of
those, your history ends up scattered across half a dozen accounts, each with
its own ratings, statuses, and statistics that never add up to a single picture.
Logarium exists to be the *one* place for all of it: every medium, one library,
one set of statistics, one search box, all while still pulling rich metadata
(covers, release years, episode/chapter counts, genres) from the same
authoritative sources those specialised sites use.

It's built for people with broad, cross-format tastes: someone who finishes a
Korean web novel, an indie game, and a 1970s film in the same week and wants all
three to land in the same backlog, count toward the same yearly stats, and be
discoverable from the same search.

**Public demo:** [https://logarium.vercel.app](https://logarium.vercel.app)
Register an account, or sign in with the throwaway demo user:

- username: `demo_user`
- password: `password1`

> `demo_user` is force-refreshed every 24 hours from the maintainer's library
> (a one-way replace; all changes are wiped). Feel free to experiment with it.

---

## What You Track

Every item in your library is an **Entry** with a consistent shape regardless of
medium, so a film and a web novel are filtered, sorted, and counted the same way:

- **Medium**: Film, TV Show, Anime, Book, Manga, Light Novel, Web Novel, Comic,
  Game, Visual Novel.
- **Origin**: Japanese, Korean, Chinese, Western, Other (so you can slice your
  habits by where the work comes from, not just what format it is).
- **Status**: `current`, `planned`, `completed`, `on_hold`, `dropped`.
- **Progress**: current vs. total episodes / chapters / pages.
- **Rating**: 0 to 10, with half-point granularity.
- Plus year, free-text notes, a cover image, and provenance (which external
  source the metadata came from).

---

## Features

### Library management
- **One unified library** across all ten mediums, with a fast sortable,
  filterable, paginated table (sort by title, rating, status, year, last
  updated, or completion date).
- **Quick status & progress edits** inline, plus a full detail/edit modal per
  entry. `completed_at` is set automatically the moment an entry flips to
  `completed` (and cleared if it moves back), so "what did I finish this year"
  is always accurate without manual bookkeeping.
- **Bulk management** via Library's multi-select mode (the right-sidebar
  "Multi-select" toggle): select entries and bulk-edit a field (rating, medium,
  origin, year, total…), bulk-delete, or — from the Console page — find and merge
  duplicates.

### Adding media
- **Auto metadata search**: type a title and Logarium fans out across **13
  external providers** concurrently, normalises every result into a common
  shape, deduplicates by title/medium, and ranks them (exact-title matches
  first) so you can add a fully-populated entry (cover, year, counts, source)
  in one click. Which providers are offered is configurable sitewide on the
  Console page (defaulting to roughly one per medium to avoid duplicate hits
  across overlapping sources). Providers covered:

  | Domain            | Providers                                             |
  |-------------------|-------------------------------------------------------|
  | Film & TV         | TMDB                                                  |
  | Anime & Manga     | AniList, Jikan (MyAnimeList), Kitsu, MangaDex         |
  | Games             | IGDB, RAWG                                            |
  | Books             | Google Books, Open Library                            |
  | Novels            | NovelUpdates, MangaUpdates                            |
  | Comics            | ComicVine                                             |
  | Visual Novels     | VNDB                                                  |

  Every provider is **optional and best-effort**: one with no API key, or one
  that errors or times out, is silently skipped so you always get partial
  results rather than a failed search.

- **Add by URL**: paste a supported source URL and Logarium resolves it to a
  prefilled entry.
- **Manual entry** for anything the providers don't cover.

### Discovery
- **Explore page**: personalised recommendations. Logarium builds a
  *consumption profile* from your library (which genres, origins, and mediums
  you actually consume), fans out to each provider's trending/popular endpoints,
  drops anything already in your library, and ranks the rest by popularity
  biased toward your tastes, along whichever dimension (genre / medium / origin)
  you choose on the Console page. Turn **Personalize** off there for a fully
  neutral recommender (no bias, even medium mix — the sidebar shows "bias off").
  A Refresh button reshuffles with seeded jitter.

### Statistics
- **Rich dashboards** powered by Recharts: totals and breakdowns by medium,
  origin, and status; rating distributions; activity over time; completion
  streaks; and a "currently consuming / recently completed" overview on the
  home dashboard.

### Import & export
- **CSV / JSON export** of your entire library, and matching import.
- **MyAnimeList importer** for migrating an existing MAL export.
- **Preview → confirm** flow: imports are classified into to-import,
  duplicates, and conflicts before anything is written.
- **Streaming auto-import**: an SSE endpoint that searches metadata for each
  imported row live, so a bare list of titles comes back enriched with covers
  and details.

### Browser extension (Chrome + Firefox)
- Add the media page you're currently viewing to your library in **two clicks**,
  straight from the source site.
- **Caches covers from Cloudflare-protected sites** (e.g. NovelUpdates) that
  can't be hot-linked: the extension fetches the image first-party (attaching
  your own `cf_clearance` cookie) and uploads the bytes to your server, which
  stores them so the cover renders from your own cache afterward.
- Doubles as a silent search fallback for sources (like NovelUpdates) that are
  Cloudflare-blocked server-side.

### Accounts & data
- **Multi-user** with JWT bearer auth; **every** library/stats/search query is
  scoped to the owning user, so accounts are fully isolated.
- **Console page** consolidating settings (password, theme & accent colour,
  per-page layout, Explore bias & personalisation, available search sources) and
  library tools (custom lists, duplicate finder, cover caching, import/export,
  data wipe).
- **Optional email backups**: when SMTP is configured, a background scheduler
  emails periodic library backups on each user's chosen cadence.

---

## How It Works

**Service-oriented backend.** The FastAPI layer (`backend/routers.py`) is a thin
set of handlers; all real logic lives in `backend/services/*` (entries, search,
stats, import/export, explore, covers, backups). Ownership scoping is enforced
in the handlers, so every data path is tenant-safe by construction.

**Search as a provider fan-out.** `search_service.py` either routes to one named
provider or queries all of `search_providers/*` concurrently, normalises each
into a common `SearchResult`, deduplicates, and ranks by source priority. Each
provider is an independent module registered in one place; graceful degradation
(skip on missing key/failure) is a hard contract. Discovery on the Explore page
works similarly but hits each provider's trending endpoints and biases ranking
by your consumption profile, caching results per `(user, medium)`.

**Cover caching.** Some sources (notably Cloudflare-gated novel sites) block
hot-linking and server-side fetches. The browser extension solves this from the
client side: it fetches the image as a first-party request with the user's own
cookies and uploads the bytes to the backend (`/covers/upload`), which stores
them on disk (`COVER_CACHE_DIR`) and serves them back. The web app and extension
share the same API helpers and modal components so behaviour stays in sync.

**Auth & data integrity.** JWT bearer tokens (`python-jose`), passwords hashed
with `passlib` bcrypt_sha256. `User.username` is the primary key and the foreign
key on `Entry`. Canonical enums (statuses, mediums, origins) are validated on
the backend and mirrored on the frontend. Schema changes go through Alembic
migrations, which are the source of truth for the database.

**Frontend.** A React + Vite SPA (React Router) gated on auth state, with pages
for Dashboard, Library, Explore, Statistics, and Console (settings + library
tools; Manage is a multi-select mode within Library). All network calls go
through a single `api.jsx` helper layer; styling is plain CSS in a deliberate
dark terminal aesthetic (no UI framework), with a user-selectable accent colour.

---

## Tech Stack

| Layer     | Technology                                              |
|-----------|---------------------------------------------------------|
| Frontend  | React 18, React Router 7, Vite, plain CSS, Recharts     |
| Backend   | Python 3.11+, FastAPI, SQLAlchemy 2, Alembic, uvicorn   |
| Database  | PostgreSQL 14+                                           |
| Auth      | JWT (`python-jose`), `passlib` bcrypt_sha256            |
| Extension | Manifest V3 (Chrome + Firefox), Vite, `web-ext`         |

- **Frontend** dev server: port `3000`
- **Backend** API: port `6443` (interactive docs at `/docs`)

---

## Repository Layout

```
logarium/
├── backend/         FastAPI app (services, routers, Alembic migrations)
├── frontend/        React + Vite web app
├── extension/       Manifest V3 browser extension (Chrome + Firefox)
├── public/          Misc scripts and notes
└── context.md       Extended reference (data model, API contract, env vars)
```

---

## Data Model

Every tracked item is an **Entry**, owned by a **User** (`username` is the PK and
the FK on `Entry`). Key fields:

| Field          | Type     | Notes                                                            |
|----------------|----------|------------------------------------------------------------------|
| `id`           | int      | Primary key                                                      |
| `title`        | string   | Required, 1–500 chars                                            |
| `medium`       | string   | Film · TV Show · Anime · Book · Manga · Light Novel · Web Novel · Comic · Game · Visual Novel |
| `origin`       | string   | Japanese · Korean · Chinese · Western · Other                   |
| `year`         | int      | Release year                                                     |
| `status`       | string   | current · planned · completed · on_hold · dropped               |
| `rating`       | float    | 0–10                                                             |
| `progress`     | int      | Current episode / chapter / page                                |
| `total`        | int      | Total episodes / chapters / pages                               |
| `cover_url`    | string   | Cover image URL                                                  |
| `notes`        | text     | Free-text notes                                                  |
| `external_id`  | string   | ID from the source API                                          |
| `source`       | string   | Which provider the metadata came from                           |
| `created_at` / `updated_at` / `completed_at` | datetime | Timestamps (`completed_at` is auto-managed on status change) |

Full API contract and architecture notes live in `AGENTS.md`, `context.md`, and
`backend/README.md`. Interactive API docs are served at `/docs` when the backend
is running.

---

## Setup From Scratch

Prerequisites: **Git**, **Python 3.11+**, **Node.js 18+** (with npm), and
**PostgreSQL 14+**. The instructions below assume Linux/macOS; on Windows use
WSL or adjust the activation/`psql` commands accordingly.

Clone the repo first:

```bash
git clone <repo-url> logarium
cd logarium
```

### 1. Database (PostgreSQL)

**Install PostgreSQL.**

```bash
# Debian / Ubuntu
sudo apt update && sudo apt install -y postgresql postgresql-contrib

# macOS (Homebrew)
brew install postgresql@16 && brew services start postgresql@16
```

On Debian/Ubuntu the server starts automatically; verify with
`sudo systemctl status postgresql`.

**Create the database and a user.** Open a `psql` shell as the `postgres`
superuser:

```bash
sudo -u postgres psql        # macOS Homebrew: just `psql postgres`
```

Then, inside `psql`:

```sql
CREATE USER log WITH PASSWORD 'log_password';
CREATE DATABASE mediatracker OWNER log;
GRANT ALL PRIVILEGES ON DATABASE mediatracker TO log;
\q
```

The schema itself is **not** created by hand; Alembic migrations build it in
step 2. (Connection string for the above: `postgresql://log:log_password@localhost:5432/mediatracker`.)

### 2. Backend (FastAPI)

```bash
cd backend

# Create and activate a virtualenv
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

**Configure environment.** Create `backend/.env`:

```env
# Required
DATABASE_URL=postgresql://log:log_password@localhost:5432/mediatracker
CORS_ORIGINS=http://localhost:3000          # comma-separated allowed web-app origins
SECRET_KEY=replace-with-a-long-random-secret # e.g. `openssl rand -hex 32`

# Server (defaults shown)
HOST=0.0.0.0
PORT=6443
JWT_ALGORITHM=HS256

# Cover image cache (filesystem)
COVER_CACHE_DIR=~/LOG_cache

# External search API keys (all optional; missing ones are skipped)
TMDB_API_KEY=
IGDB_CLIENT_ID=
IGDB_CLIENT_SECRET=
GOOGLE_BOOKS_API_KEY=
RAWG_API_KEY=
COMICVINE_API_KEY=

# Email backups (optional; scheduler runs only if HOST/USER/PASSWORD are all set)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
```

> AniList, Jikan, Kitsu, MangaDex, Open Library, NovelUpdates, MangaUpdates, and
> VNDB need no key. The extension's CORS handling already allows
> `moz-extension://` / `chrome-extension://` origins regardless of `CORS_ORIGINS`.

**Build the schema** by running the migrations (the source of truth for the
database structure):

```bash
alembic upgrade head
```

**Start the server:**

```bash
python main.py                    # serves the API on http://0.0.0.0:6443
```

Verify at [http://localhost:6443/docs](http://localhost:6443/docs).

*(Optional)* seed sample entries for quick testing:

```bash
python scripts/init_db.py --seed
```

*(Production)* run under uvicorn with workers, behind nginx:

```bash
uvicorn main:app --host 0.0.0.0 --port 6443 --workers 4
```

### 3. Frontend (React + Vite)

```bash
cd frontend
npm install
```

**Configure environment.** Create `frontend/.env` pointing at your backend:

```env
VITE_API_BASE=http://localhost:6443
```

For a deployed build, add `frontend/.env.production` with the public API URL,
e.g. `VITE_API_BASE=https://your-domain:6443`.

**Develop:**

```bash
npm start                         # Vite dev server on http://localhost:3000
```

**Build for production:**

```bash
npm run build                     # outputs static bundle to frontend/dist
npm run preview                   # serve the built bundle locally to verify
```

Deploy `dist/` to any static host (the repo includes `vercel.json` for Vercel).
Make sure the web app's origin is included in the backend's `CORS_ORIGINS`.

### 4. Browser Extension (Manifest V3)

The extension reuses the frontend's modals, so it reads the same `VITE_API_BASE`
at build time. `extension/.env` targets local dev; `extension/.env.production`
targets the deployed backend.

```bash
cd extension
npm install
```

#### Development build (load unpacked)

```bash
npm run build                     # builds to extension/dist using .env (local)
npm run dev                       # same, rebuilding on change (vite build --watch)
```

Then load `extension/dist` as a temporary/unpacked extension:

- **Chrome:** `chrome://extensions` → enable **Developer mode** → **Load
  unpacked** → select `extension/dist`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary
  Add-on** → select any file inside `extension/dist` (e.g. `manifest.json`).

> Temporary installs are wiped on Firefox restart and nag on every Chrome
> startup. For a permanent install, package/sign as below. Production builds
> (`package` / `sign:firefox`) use `.env.production` automatically.

#### Permanent Chrome `.zip`

```bash
npm run package                   # → extension/dist-artifacts/logarium-<version>-chrome.zip
```

Distribute via the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
($5 one-time fee): **New item** → upload the zip → set **Visibility: Unlisted**
→ complete the listing. The review justifies the broad permissions
(`<all_urls>` + `cookies` + `declarativeNetRequestWithHostAccess`), which exist
solely to fetch cover images first-party and attach the user's own
`cf_clearance` cookie for Cloudflare-gated covers. Bump `version` in
`extension/public/manifest.json` for each update.

#### Permanent Firefox `.xpi` (signed)

Release Firefox refuses unsigned add-ons. Sign through Mozilla's **unlisted**
channel (automated review, free, no public listing). The manifest already
carries the required `browser_specific_settings.gecko.id`.

1. Get API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Sign:
   ```bash
   export WEB_EXT_API_KEY="user:xxxxxxxx:123"
   export WEB_EXT_API_SECRET="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   npm run sign:firefox          # → extension/dist-artifacts/*.xpi
   ```
3. Install permanently: `about:addons` → gear icon → **Install Add-on From
   File…** → pick the `.xpi`.

Bump `version` in `extension/public/manifest.json` before each signed build
(AMO rejects duplicate versions).

> The extension's bridge content script is only injected on the origins listed
> under `content_scripts.matches` in `extension/public/manifest.json`
> (`localhost:3000` and `logarium.vercel.app` by default). If you host the web
> app elsewhere, add that origin there or the web app won't detect the extension.

### 5. Database migrations (ongoing)

After changing a model, create and apply a migration:

```bash
cd backend
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
alembic downgrade -1              # roll back one step
```

---

## License

This project is for personal use and portfolio demonstration. For other uses,
please contact the author.
