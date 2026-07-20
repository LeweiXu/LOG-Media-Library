# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Logarium ("LOG") is a full-stack media tracker (films, TV, anime, games, books, manga, light/web novels, comics) with a React + Vite frontend and a FastAPI + PostgreSQL backend. `AGENTS.md` and `context.md` contain additional reference detail (data model, full API contract, env vars) — consult them, but note `context.md`'s file tree lags the current layout.

## Commands

Backend (`cd backend`):
```bash
source ~/venvs/LOG-venv/bin/activate   # the project venv (has psycopg2 etc.)
pip install -r requirements.txt
alembic upgrade head            # apply migrations (required before first run)
python main.py                  # serve API on :6443 (also creates tables via lifespan)
python scripts/init_db.py --seed  # seed sample data (optional)
```

The project's Python virtualenv lives at `~/venvs/LOG-venv` — always use it for
backend commands and import checks (e.g. `~/venvs/LOG-venv/bin/python -c ...`).

Frontend (`cd frontend`):
```bash
npm install
npm start        # Vite dev server on :3000
npm run build    # production bundle (use this to validate frontend changes)
npm run preview
```

Browser extension (`cd extension`):
```bash
npm install
npm run build      # validate and regenerate extension/dist
npm run lint       # lint the generated extension
npm run release    # bump patch, build, make the Chrome zip, and sign the Firefox xpi
```

Use `npm run release` for every finished extension release. It reads the AMO signing credentials from `extension/.env`, bumps the patch version by default, writes both installable files to `extension/dist-artifacts/`, and removes older archives. Use `npm run release -- minor` or `npm run release -- major` only for an intentional larger version bump. Commit the version files, generated `dist/`, new archives, and deleted old archives together. Do not use `npm run package` as a replacement because it does not produce the signed Firefox build.

`./dev.sh` (repo root) boots backend (`python run.py`, same as `main.py`) and
frontend together with one Ctrl+C cleanup — the fastest way to run the full stack.

There is **no test runner**. Validate backend changes against `http://localhost:6443/docs`; validate frontend changes with `npm run build`. One-off scripts live in `backend/scripts/` and `public/` (e.g. `public/test_novelupdates.py` is a targeted scraper check).

## Architecture

**Service-oriented backend.** `routers.py` is a single `APIRouter` of thin handlers; all business logic lives in `backend/services/*`. Adding behavior means adding/extending a service, not fattening the router. DB access uses `Depends(get_db)` (`db.py`); auth uses `Depends(auth_service.get_current_user)`.

**Auth & multi-tenancy.** JWT bearer auth (`python-jose`), passwords hashed with `passlib` bcrypt_sha256. `User.username` is the PK and the FK on `Entry`. **Every entry/list/stats query must be scoped to `current_user.username`** — ownership is enforced in the router handlers, so any new data path must preserve that scoping.

**Search is a provider fan-out.** `services/search_service.py` routes a query to one provider (when `source` is given) or fans out across all of `services/search_providers/*` concurrently, normalizes each result to a `SearchResult`, deduplicates by title/medium, and ranks by source priority (exact-title matches first, capped at 10). Every provider is **optional and best-effort**: a missing API key or a failing call is silently skipped so partial results always return. When editing search, preserve this graceful-degradation contract. Each provider module exposes a `search_*` function registered in `search_providers/__init__.py`.

**Canonical enums** (statuses, mediums, origins) are validated in `backend/constants.py` / `schemas.py` and mirrored in `frontend/utils.jsx`. Changing the allowed sets means updating both sides plus likely a migration.

**`completed_at` is auto-managed** when an entry's status transitions to/from `completed` — don't set it manually from new code paths.

**Background backup scheduler.** `main.py`'s lifespan starts an async loop (`backup_service.tick_due_backups`) only when SMTP is configured (`settings.smtp_configured`). It ticks every `BACKUP_TICK_SECONDS`, opening a fresh DB session per tick and swallowing errors so the loop survives. See `backend/BACKUP.md`.

**Import/export.** CSV/JSON and MAL import flows live in `import_service.py` / `import_mal_service.py` / `export_service.py`. Import is a preview→confirm two-step (classifying rows into to-import / duplicates / conflicts); `/entries/import/auto` is an **SSE stream** that searches metadata row-by-row.

**Frontend.** `app.jsx` holds React Router routes (`/dashboard`, `/library`, `/explore`, `/statistics`, `/console`) gated on auth state in localStorage (`auth_token`, `auth_username`); unauthenticated users get `LandingPage` / `AuthModal`. Two legacy redirects: `/manage` → `/library?mode=manage` (Manage merged into Library as a `?mode=manage` view, also toggled by the right-sidebar "Multi-select" chip), and `/settings` → `/console` (Settings merged into Console). The topbar shows the username as plain non-clickable text — the Console nav link is the way in. Pages are in `frontend/pages/`, modals/shared UI in `frontend/pages/components/`. **All API calls go through helpers in `frontend/api.jsx`** (which reads `VITE_API_BASE`) — do not scatter raw `fetch` calls in components. Statuses/medium/origin constants and list-normalization helpers live in `frontend/utils.jsx`.

**Console page & library tools.** `pages/Console.jsx` is the merged Settings + library-tools page (after Statistics in the nav). It hosts the former settings sections plus collapsible inline tool panels — `ListsPanel`, `DedupPanel`, `CacheCoversPanel`, `ResyncPanel`, `Import{,Auto,Mal}Panel` — each extracted as a `*Panel` body so it renders inline (no overlay) inside a `CollapsibleSection` that **unmounts on collapse** (so SSE streams abort). `ListsModal` is a thin wrapper that still renders `ListsPanel` inside a modal for Library's "+ New" list chip.

**Explore / recommendations.** `services/explore_service.py` builds a per-user consumption profile and ranks each provider's trending results, biased toward the user's tastes along `ui.explore.by`. The `ui.explore.personalize` toggle is honoured server-side: when off, ranking is neutral (no genre/medium/origin bias, even medium mix) and the response's `personalised=false` (Explore's sidebar shows "bias off"). Results are cached per `(user, medium, personalize, available-sources-hash)`; the cache key must stay short — `explore_cache.medium` is `VARCHAR(50)`, so the source set is hashed, never inlined.

**Search sources (availability).** Which providers the Add-Entry and Explore source pickers offer is a sitewide selection in `frontend/pages/components/searchSources.js` (`loadAvailableSources`/`saveAvailableSources`, localStorage key `available_sources`), defaulting to `DEFAULT_SOURCES` — roughly one provider per medium (RAWG for games) to avoid duplicate hits across overlapping sources. Explore passes this set to `/explore?sources=…` so the backend only draws from available providers. This is a deliberate localStorage exception to the "no parallel localStorage prefs" rule below (it predates and is shared with the pickers). The per-picker *selection* narrowing which available sources to actually query (the chips in Add-Entry/Explore) is plain in-memory component state, deliberately not persisted — it resets to "all available" on every page load/reload.

**UI preferences.** `frontend/preferences.jsx` exposes `PreferencesProvider` (wraps the app, keyed on username) and a `userefs` hook backed by the backend's single `ui_preferences` JSON doc; `DEFAULT_UI` there mirrors `schemas.DEFAULT_UI`. Per-page layout (visible columns, row counts, default modes/sorts, stats sections) reads from this — don't add parallel localStorage prefs. Scalar columns on `User` stay authoritative for server-side consumers (backup/explore); the JSON doc is the client view.

## Conventions

- Plain CSS only (`styles.css`, `design.css`) — no Tailwind or CSS-in-JS without a deliberate migration. `design.css` is the design-system reference; read it before adding UI.
- **Terminal theme.** Dark utilitarian / IBM Plex Mono aesthetic. **No rounded corners** — never add `border-radius` (the only exceptions are genuine circles: status dots, pie charts). Separation comes from 1px `var(--border)` lines and `var(--bg)`/`var(--surface)` contrast, not shadows. Use CSS variables for all colours; never hardcode.
- **Checkboxes & radios** are globally restyled to the terminal look (square bordered box, accent `×` / square dot when checked — mirroring the `[x]`/`[ ]` source chips). Plain `<input type="checkbox">`/`type="radio"` inherit this automatically; don't roll custom toggles.
- Python: 4-space indent, snake_case. JSX/CSS: 2-space indent; PascalCase component files, camelCase functions/state.
- Migrations: add an Alembic revision under `backend/alembic/versions/` for any schema change (`main.py` also runs `create_all`, but migrations are the source of truth for existing DBs).
- Secrets stay in `backend/.env` / deployment vars — never commit API keys, SMTP credentials, DB URLs, or `SECRET_KEY`.
- Commit messages: short imperative one-liners describing the user-visible change (e.g. `fix logout button nonexistent on mobile`).
