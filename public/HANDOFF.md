# Handoff: frontend data layer, cover cache, and preloading

This covers the work around perceived speed: a React Query data layer with
standardized silent updates, session hydration, route code-splitting, a 3-size
server-side cover cache, Dashboard bootstrap data, and hover-preloading across
the app. It's meant to get the next person oriented without re-reading every
commit.

Relevant commits (newest first): `e5df5b8`, `89f70be`, `5255dc2`, `afc3249`, `2234cde`, `e8ca30e`,
`c079d8b`, `a07cb46`, `c01684e`, `f73e009`, `2b84ebf`,
`d7ad7aa`, `5da4a63`, `6c64913`, `d611066`, `b29019d`, `0542bfe`, and the earlier
React-Query commits (`5ce63a7`, `334c07b`, `ab951d7`).

## 1. Frontend data layer (TanStack Query)

Lives in `frontend/data/`:
- `client.jsx` - the singleton `queryClient` + `DataProvider` (wraps the app in
  `index.jsx`). Defaults: `staleTime: Infinity`, `gcTime: 30m`,
  `refetchOnWindowFocus: false`, `retry: 1`.
- `keys.js` - query-key factories for entries, counts, lists, statistics,
  bootstraps, and library revision, plus `defaultLibraryParams(prefs)` (mirrors what
  Library queries on a fresh mount, so nav-hover prefetch keys match).
- `hooks.jsx` - read hooks, bootstrap seeders, revision checks, direct-cover
  prefetch helpers, and `useEntryMutations`.

**Standardized silent updates.** Every entry mutation goes through one contract in
`useEntryMutations`: optimistic `setQueryData` patch -> rollback on error ->
`invalidateEntryData` on settle. Invalidation refetches the *active* view with its
current sort/filter, so an edited row re-sorts / drops out on its own. This
replaced the old per-page patch-in-place logic that didn't reconcile sort/filter.
Modal edits use `syncUpdatedEntry` / `syncDeletedEntry` (same effect for the
edit-modal path, which still writes through the API itself).

`invalidateEntryData(qc)` invalidates `entries` + `entryCounts` + `customLists` +
`stats` + both bootstrap queries. That's the "clear the table preloads when the
library changes" mechanism.

Per-user isolation: `queryClient.clear()` runs on login/logout in `app.jsx`.

Selected successful queries are also saved to user-scoped `sessionStorage` by
`data/client.jsx`. This includes entries, counts, lists, statistics, both
bootstraps, and the library revision. A hard reload paints the stored data first
and checks the small revision endpoint before deciding whether larger payloads
need revalidation. Saved settings use the same pattern in `preferences.jsx`.
Login, logout, account switches, and data wipe clear the matching user's data.

**Explore is deliberately NOT on React Query** for its recommendation data. It
keeps its reroll-survival logic and a user-scoped page cache in
`pages/Explore.jsx`. That cache is saved to `sessionStorage`, paints before a
background revalidation, and is cleared with the other user data.

## 2. Code-splitting

`app.jsx` lazy-loads the 5 pages (`ROUTE_LOADERS` + `React.lazy`), which pulls
recharts out of the main bundle into the Statistics chunk. Nav hover warms a
route immediately. Automatic warming waits until after `load`, warms the smaller
chunks after 2.5 seconds, and leaves Statistics and Console until 6.5 seconds.
It is disabled for data-saver and very slow connections.

IBM Plex Mono is served locally from `frontend/public/fonts`, so a cold start no
longer waits on Google Fonts.

## 3. Cover cache (3 fixed sizes + original)

Backend: `backend/services/cover_cache_service.py`, config in `backend/config.py`,
routes in `backend/routers.py`.

Each source cover is cached at 3 display sizes, fit-cropped (upscaling smaller
sources) to exactly fill their box, plus the native original:
- `thumb`  56x80   - every table row (Dashboard + Library)
- `medium` 184x264 - Explore cards
- `full`   500x750 - entry detail modal (uniform size for every cover)
- `original/` - native original, kept only so sizes can be re-derived later
  without re-downloading (matters for NU/Cloudflare covers we can't refetch)

Files: `~/LOG_cache/{thumb,medium,full,original}/<sha256(url)>.jpg`. Dimensions are
in config; change them and re-run the script with `--force` (see 6).

**Fetching external images only happens at ingest, never at serve time:**
1. Add entry via app: `create_entry`/`update_entry` schedule a background
   `cache_one_cover` (best-effort; NU/Cloudflare fail here and rely on 2).
2. Add via extension: `POST /covers/upload` sends original bytes -> `store_cover_bytes`.
3. Explore reroll/load: `GET /explore` schedules `ensure_covers_cached` for the
   result covers in the background (Explore items aren't library entries, so this
   is their ingest).

`cache_one_cover` reuses bytes it already has (the kept original, or a legacy
pre-3-size `full/` file) before ever hitting the network - that's how NU covers
that were cached under the old scheme get converted with no re-download.

**Serving is cache-only:**
- `/covers/{size}/{sha256}.jpg` is the normal browsing path. Entry and Explore
  responses include the hash, and Starlette serves the cache directories as
  static files with one-year immutable caching.
- `GET /covers/img?url=&size=` remains as a compatibility fallback for search
  and add surfaces that only have the original URL.
- The old base64 `/covers/bundle` route has been removed.

**Frontend never hotlinks external covers** on the browsing surfaces. Dashboard,
Library, Explore, and the detail modal all use hashed immutable resources. The
browser reuses each file across pages and hard reloads, and Cloudflare caches the
same URL at the edge. Search/add/import preview surfaces still use external URLs
because those items are not in the library cache yet.

## 4. Preloading

Everything preloads on hover and, thanks to `staleTime: Infinity`, only once per
app session (a second hover no-ops); library mutations invalidate the table queries
so they re-preload after a change.

- Nav links (`app.jsx` `prefetchRouteData`): Dashboard warms one
  `/bootstrap/dashboard` response and decodes the exact thumbnails the page
  mounts. The bootstrap contains the five status buckets plus only the summary
  fields Dashboard uses. It skips the five list count queries and does not run
  the full Statistics calculation. Library warms one `/bootstrap/library`
  response with the first page, counts, and lists. Statistics warms stats, Explore calls
  `prefetchExploreHome` (exported from the lazy Explore chunk).
- Library sidebar filters, all sort controls (column headers, the filter-bar sort
  dropdown via CustomSelect's new `onOptionHover`, the asc/desc toggle, the
  right-sidebar sort list), list chips, page-size options, clear-filters, and
  pagination buttons preload the entries + thumbs for the state they produce.
  Filter and sort clicks reset the page in the same event so the query never
  briefly requests the old page number with the new filter.
- Dashboard sidebar filters prefetch the Library query (+ thumbs) that clicking
  navigates to.
- Explore medium filters and pagination preload a 30-entry metadata page and
  decode its cached medium covers. Clicking after that preload does not make a
  new metadata or image request.
- Table rows prefetch the `full` cover on hover (`prefetchFullCover`), so the detail
  modal image is instant on click.

The main shared helpers are `prefetchDashboard`, `prefetchLibraryBootstrap`,
`prefetchEntriesWithCovers`, and `prefetchCoverImages`.

## 5. There are 4 tables total

Dashboard has 3 (Current / Planned / Recently Completed), Library has 1. Their
entry queries are refreshed by `invalidateEntryData`. Covers use immutable hash
URLs, so a changed source URL naturally produces a different browser cache key.

## 6. Deploy steps

The backend is managed by the enabled `logarium-api.service` user unit on the
home server. It runs one uvicorn worker on port 8001 without reload mode. User
lingering is enabled, so the service starts at boot without an interactive
login.

Deploy backend changes from the repository root:

```bash
./deploy.sh
```

The script syncs `backend/` to `~/LOG_Project/` without touching the server's
`.env`, installs the checked-in unit, compiles Python files, runs Alembic,
restarts the service, and checks `http://127.0.0.1:8001/`. Useful controls are:

```bash
ssh lingwei@192.168.20.9 'systemctl --user status logarium-api'
ssh lingwei@192.168.20.9 'journalctl --user -u logarium-api -f'
```

After deploying frontend + syncing backend + restarting the API, run the cover
script once on the server (backend lives at the repo root there, so run it as a
module or by path):

```bash
cd ~/LOG_Project
python -m scripts.cache_all_covers          # or: python scripts/cache_all_covers.py
```

- Already-cached NU/Cloudflare covers come back as `reused` (rebuilt offline from
  the existing bytes - no network, no extension needed).
- Ordinary CDN covers are `cached` (downloaded server-side).
- Uncached NU/Cloudflare covers `failed` - those need the extension's Resync Covers.
- Add `--clean-legacy-thumbnails` to drop the old 96x144 `thumbnails/` dir.
- **After changing a size dimension** (e.g. the modal `full`), run with `--force` to
  regenerate existing caches from the kept originals (offline).

No DB migration is involved (cover cache is filesystem-only). No new env vars.

## 7. How this was verified

There's no test runner. Backend was checked with direct PIL/service calls; the
frontend was driven in real headless Chrome over the DevTools Protocol (Node has a
global `WebSocket`, so a small CDP client sets the auth token in localStorage,
navigates, dispatches real hover/click events, and reads `performance.getEntriesByType('resource')`
to confirm which requests fire). The production check covered Library bootstrap,
revision-only focus checks, hashed cover requests, decoded image state, and a
Dashboard hover followed by a click. The click made no Dashboard data or cover
requests after the hover work finished.

## 8. Known gaps / not verified live

- Cached Explore navigation was checked against mocked browser data because the
  dev environment has no provider recommendations. It verified 30-entry server
  pages, pagination hover, no click refetch, direct cached images, and immediate
  session hydration. The production API still needs to be checked after its
  backend restart.
- Production Library pagination has enough data to exercise nearby-page warming.
  That warming now waits until the visible page's thumbnails decode, then waits
  another second before starting off-screen requests.
